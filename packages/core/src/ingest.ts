// `drl sync <source>` (SPEC section 9, ADR-0004): git sync, parse and chunk the
// changed files, diff chunk hashes against the index, embed only new or
// changed chunks (through the cache), then write everything in one transaction.
// A new chunker or parser version re-parses every file; unchanged chunk text
// keeps its vector, so that costs no tokens.
import type { DocumentWrite, EmbeddingCache, IndexStats, SourceIndex } from '@docs-rag-lab/db'
import {
  CHUNKER_VERSION,
  chunkDocument,
  listSourceFiles,
  readSourceFile,
  sha256Hex,
  syncRepo,
  type Chunk,
  type Source,
  type SourceFile,
} from '@docs-rag-lab/source-kit'

import { embedWithCache, type EmbedProgress } from './embeddings/cached.ts'
import type { EmbeddingProvider } from './embeddings/provider.ts'
import type { RateLimiter } from './embeddings/rate-limit.ts'
import type { UsageMeter } from './usage.ts'

export type SyncProgress =
  | { phase: 'git'; message: string }
  | { phase: 'parse'; files: number; mode: 'full' | 'incremental'; reason?: string }
  | { phase: 'embed'; progress: EmbedProgress }
  | { phase: 'write' }

export interface SyncSourceOptions {
  source: Source
  provider: EmbeddingProvider
  index: SourceIndex
  cache: EmbeddingCache
  /** The git checkout for this source, for example .cache/sources/typescript. */
  checkoutDir: string
  meter: UsageMeter
  limiter?: RateLimiter | undefined
  /** Re-parse every file even if git reports no change. */
  full?: boolean | undefined
  onProgress?: ((event: SyncProgress) => void) | undefined
  now?: () => Date
}

export interface SyncReport {
  mode: 'full' | 'incremental'
  /** Why the sync was full, when it was. */
  reason: string | undefined
  previousSha: string | undefined
  headSha: string
  documents: { added: number; modified: number; unchanged: number; deleted: number }
  chunks: { added: number; changed: number; unchanged: number; deleted: number }
  /** Chunk texts that needed a vector, and how many of those came from the cache. */
  vectors: { needed: number; embedded: number; cached: number }
  /** Estimated tokens of the texts sent to the provider, to compare with billed tokens. */
  estimatedTokens: number
  stats: IndexStats
}

/** Same entries in any order: reordering include paths changes nothing. */
function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const sorted = (list: readonly string[]) => JSON.stringify([...list].sort())
  return sorted(a) === sorted(b)
}

/** Why the index must be rebuilt from scratch, or undefined if an incremental sync is fine. */
function fullRebuildReason(options: SyncSourceOptions): string | undefined {
  const { index, provider, source } = options
  const manifest = index.getManifest()
  if (options.full === true) return 'requested'
  if (manifest === undefined) return 'no previous sync'
  if (manifest.embedModel !== provider.id) {
    return `embedding model changed from ${manifest.embedModel} to ${provider.id}`
  }
  if (manifest.chunkerVersion !== CHUNKER_VERSION) {
    return `chunker version changed from ${String(manifest.chunkerVersion)} to ${String(CHUNKER_VERSION)}`
  }
  if (manifest.parserVersion !== source.parserVersion) {
    return `parser version changed from ${String(manifest.parserVersion ?? 'none')} to ${String(source.parserVersion)}`
  }
  if (manifest.repo !== source.repo || manifest.branch !== source.branch) {
    return 'repository or branch changed'
  }
  if (!sameSet(manifest.includePaths, source.include)) return 'include paths changed'
  return undefined
}

interface ParsedFile {
  file: SourceFile
  url: string
  title: string
  docType: string
  metadata: Record<string, unknown>
  chunks: Chunk[]
}

export async function syncSource(options: SyncSourceOptions): Promise<SyncReport> {
  const { source, provider, index, cache, meter } = options
  const manifest = index.getManifest()
  const rebuildReason = fullRebuildReason(options)
  // No manifest also means no vectors yet: every chunk needs one.
  const resetVectors = manifest?.embedModel !== provider.id || !index.hasVectorTable()

  options.onProgress?.({ phase: 'git', message: `syncing ${source.repo} (${source.branch})` })
  const repo = await syncRepo(source, {
    checkoutDir: options.checkoutDir,
    previousSha: manifest?.commitSha,
    full: rebuildReason !== undefined,
  })
  const mode = repo.mode
  const reason = rebuildReason ?? (repo.mode === 'full' ? repo.reason : undefined)

  const indexed = new Set(index.documentPaths())
  let files: SourceFile[]
  let deletePaths: string[]
  if (repo.mode === 'full') {
    files = listSourceFiles(options.checkoutDir, source)
    const present = new Set(files.map((file) => file.path))
    deletePaths = [...indexed].filter((path) => !present.has(path))
  } else {
    files = repo.changed.map((path) => readSourceFile(options.checkoutDir, path))
    deletePaths = repo.deleted.filter((path) => indexed.has(path))
  }
  options.onProgress?.({
    phase: 'parse',
    files: files.length,
    mode,
    ...(reason === undefined ? {} : { reason }),
  })

  const parsed: ParsedFile[] = []
  for (const file of files) {
    const doc = await source.parse(file, { commitSha: repo.headSha })
    parsed.push({
      file,
      url: doc.url,
      title: doc.title,
      docType: doc.docType,
      metadata: doc.metadata,
      chunks: chunkDocument(file.path, doc),
    })
  }

  // Which chunks need a vector: new ones, changed ones, or all after a model change.
  const documents = { added: 0, modified: 0, unchanged: 0, deleted: deletePaths.length }
  const chunks = { added: 0, changed: 0, unchanged: 0, deleted: 0 }
  const needVector: Chunk[] = []
  for (const { file, chunks: docChunks } of parsed) {
    const stored = index.chunkHashes(file.path)
    let touched = false
    for (const chunk of docChunks) {
      const storedHash = stored.get(chunk.id)
      if (storedHash === undefined) chunks.added++
      else if (storedHash !== chunk.textHash) chunks.changed++
      else chunks.unchanged++
      if (storedHash !== chunk.textHash) touched = true
      if (resetVectors || storedHash !== chunk.textHash) needVector.push(chunk)
    }
    const kept = new Set(docChunks.map((chunk) => chunk.id))
    const dropped = [...stored.keys()].filter((id) => !kept.has(id)).length
    chunks.deleted += dropped
    if (!indexed.has(file.path)) documents.added++
    else if (touched || dropped > 0) documents.modified++
    else documents.unchanged++
  }
  for (const path of deletePaths) chunks.deleted += index.chunkHashes(path).size

  const texts = needVector.map((chunk) => chunk.text)
  let progress: EmbedProgress = {
    embedded: 0,
    toEmbed: 0,
    cached: 0,
    estimatedTokens: 0,
    waitedMs: 0,
  }
  const vectors = await embedWithCache(texts, {
    provider,
    cache,
    inputType: 'document',
    meter,
    limiter: options.limiter,
    onProgress: (p) => {
      progress = p
      options.onProgress?.({ phase: 'embed', progress: p })
    },
  })
  const vectorById = new Map(needVector.map((chunk, i) => [chunk.id, vectors[i]]))

  options.onProgress?.({ phase: 'write' })
  const writes: DocumentWrite[] = parsed.map(
    ({ file, url, title, docType, metadata, chunks: docChunks }) => ({
      path: file.path,
      url,
      title,
      docType,
      contentHash: sha256Hex(file.content),
      lastChangedSha: repo.headSha,
      chunks: docChunks.map((chunk) => ({
        id: chunk.id,
        ordinal: chunk.ordinal,
        headingPath: chunk.headingPath,
        anchor: chunk.anchor,
        blockTypes: chunk.blockTypes,
        text: chunk.text,
        metadata: { ...metadata, spans: chunk.spans },
        tokenCount: chunk.tokenCount,
        textHash: chunk.textHash,
        vector: vectorById.get(chunk.id),
      })),
    }),
  )
  index.applyChanges({
    documents: writes,
    deletePaths,
    manifest: {
      sourceId: source.id,
      repo: source.repo,
      branch: source.branch,
      includePaths: [...source.include],
      commitSha: repo.headSha,
      syncedAt: (options.now?.() ?? new Date()).toISOString(),
      embedModel: provider.id,
      embedDimensions: provider.dimensions,
      contextModel: null,
      chunkerVersion: CHUNKER_VERSION,
      parserVersion: source.parserVersion,
    },
    resetVectors: resetVectors ? provider.dimensions : undefined,
  })

  const unique = new Set(texts).size
  return {
    mode,
    reason,
    previousSha: manifest?.commitSha,
    headSha: repo.headSha,
    documents,
    chunks,
    vectors: {
      needed: texts.length,
      embedded: progress.toEmbed,
      cached: unique - progress.toEmbed,
    },
    estimatedTokens: progress.estimatedTokens,
    stats: index.stats(),
  }
}
