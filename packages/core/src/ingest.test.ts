// M1 acceptance: incremental sync re-embeds only changed chunks (SPEC section
// 13). Runs against a local git repository in the OS temp dir, a fake source
// and a provider that records every text it embeds. No network.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { openDatabase } from '@docs-rag-lab/db'
import { git, type Source } from '@docs-rag-lab/source-kit'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CONTROL_IDENTITY, controlContexts, headingPrefix } from './contexts/control.ts'
import type { ContextDocument } from './contexts/generate.ts'
import { openIndexes, sourceIndexPath, variantIndexPath, type OpenIndexes } from './indexes.ts'
import { contextDocumentsAt, syncSource, type SyncReport } from './ingest.ts'
import { demoSource, fakeVector, paragraph, RecordingProvider } from './test-helpers.ts'
import { UsageMeter } from './usage.ts'

let root: string
let upstream: string
let dataDir: string
let checkoutDir: string
let source: Source
let open: OpenIndexes | undefined

function write(path: string, content: string): void {
  const file = join(upstream, path)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, content)
}

async function commit(message: string): Promise<string> {
  await git(['add', '-A'], { cwd: upstream })
  await git(['commit', '--quiet', '-m', message], { cwd: upstream })
  return (await git(['rev-parse', 'HEAD'], { cwd: upstream })).trim()
}

function indexes(): OpenIndexes {
  open ??= openIndexes(dataDir, source.id)
  return open
}

function closeIndexes(): void {
  open?.close()
  open = undefined
}

/**
 * Every row of the keyword index's FTS5 shadow tables, read through a second
 * connection. Equal snapshots mean FTS5 wrote nothing in between: re-indexing
 * a chunk, even with the same text, adds segments and rewrites the averages.
 */
function keywordIndexSnapshot(): string {
  const db = openDatabase(sourceIndexPath(dataDir, source.id))
  try {
    const tables = ['chunks_fts_data', 'chunks_fts_idx', 'chunks_fts_docsize', 'chunks_fts_config']
    return JSON.stringify(
      tables.map((table) => db.prepare(`select * from ${table} order by 1, 2`).all()),
    )
  } finally {
    db.close()
  }
}

async function sync(provider: RecordingProvider, full = false): Promise<SyncReport> {
  const { index, cache } = indexes()
  return syncSource({ source, provider, index, cache, checkoutDir, meter: new UsageMeter(), full })
}

// Doc A has two sections of about 500 tokens each, so they become two chunks.
const docA = (second: string) =>
  `# Doc A\n\n## First\n\n${paragraph(500, 'alpha')}\n\n## Second\n\n${paragraph(500, second)}\n`
const docB = `# Doc B\n\n## Only\n\n${paragraph(200, 'bravo')}\n`
const docC = `# Doc C\n\n## New\n\n${paragraph(200, 'charlie')}\n`

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'drl-ingest-'))
  upstream = join(root, 'upstream')
  dataDir = join(root, 'data')
  checkoutDir = join(root, 'cache', 'sources', 'demo')
  const globalConfig = join(root, 'gitconfig')
  writeFileSync(globalConfig, '[user]\n\tname = Test\n\temail = test@example.com\n')
  vi.stubEnv('GIT_CONFIG_GLOBAL', globalConfig)
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1')
  mkdirSync(upstream)
  await git(['init', '--quiet', '-b', 'main'], { cwd: upstream })
  await git(['config', 'uploadpack.allowFilter', 'true'], { cwd: upstream })
  await git(['config', 'uploadpack.allowAnySHA1InWant', 'true'], { cwd: upstream })
  source = demoSource(pathToFileURL(upstream).href)
  write('docs/a.md', docA('delta'))
  write('docs/b.md', docB)
})

afterEach(() => {
  closeIndexes()
  vi.unstubAllEnvs()
  rmSync(root, { recursive: true, force: true })
})

describe('a contextual sync', { timeout: 60_000 }, () => {
  const contextOf = (id: string): string => `Context of ${id}, about zebrafinch.`

  function contextualSync(
    provider: RecordingProvider,
    target: OpenIndexes,
    contexts: (documents: readonly ContextDocument[]) => ReadonlyMap<string, string> = (docs) =>
      new Map(docs.flatMap(({ chunks }) => chunks.map(({ id }) => [id, contextOf(id)]))),
  ): Promise<SyncReport> {
    return syncSource({
      source,
      provider,
      index: target.index,
      cache: target.cache,
      checkoutDir,
      meter: new UsageMeter(),
      contexts: {
        identity: 'claude-test:abc',
        resolve: (documents) => Promise.resolve(contexts(documents)),
      },
    })
  }

  let contextual: OpenIndexes | undefined

  function contextualIndexes(): OpenIndexes {
    contextual ??= openIndexes(dataDir, source.id, { variant: 'contextual' })
    return contextual
  }

  afterEach(() => {
    contextual?.close()
    contextual = undefined
  })

  it('embeds each chunk with its context, and keeps the text as it is', async () => {
    await commit('initial')
    await sync(new RecordingProvider())
    const plainTexts = indexes()
      .index.documentChunks('docs/a.md')
      ?.chunks.map((c) => c.text)

    const provider = new RecordingProvider()
    await contextualSync(provider, contextualIndexes())

    const { index } = contextualIndexes()
    const doc = index.documentChunks('docs/a.md')
    expect(doc?.chunks.map((c) => c.text)).toEqual(plainTexts)
    expect(doc?.chunks.map((c) => c.context)).toEqual(doc?.chunks.map((c) => contextOf(c.chunkId)))
    for (const chunk of doc?.chunks ?? []) {
      expect(provider.embedded).toContain(`${contextOf(chunk.chunkId)}\n\n${chunk.text}`)
    }
    expect(provider.embedded.some((text) => plainTexts?.includes(text))).toBe(false)
  })

  it('feeds both indexes: the vector is of the context and text, and BM25 reads the context', async () => {
    await commit('initial')
    await sync(new RecordingProvider())
    const provider = new RecordingProvider()
    await contextualSync(provider, contextualIndexes())

    const { index } = contextualIndexes()
    const [chunk] = index.documentChunks('docs/b.md')?.chunks ?? []
    if (chunk === undefined) throw new Error('no chunk')
    const vector = fakeVector(`${contextOf(chunk.chunkId)}\n\n${chunk.text}`, provider.dimensions)
    expect(index.searchVectors(vector, 1)[0]?.chunkId).toBe(chunk.chunkId)
    expect(index.searchVectors(vector, 1)[0]?.score).toBeCloseTo(0, 5)

    expect(index.searchKeywords('"zebrafinch"', 10).map((c) => c.chunkId)).toContain(chunk.chunkId)
    expect(indexes().index.searchKeywords('"zebrafinch"', 10)).toEqual([])
  })

  it('records the model and prompt in the manifest, and the plain index says none', async () => {
    await commit('initial')
    await sync(new RecordingProvider())
    await contextualSync(new RecordingProvider(), contextualIndexes())
    expect(contextualIndexes().index.getManifest()?.contextModel).toBe('claude-test:abc')
    expect(indexes().index.getManifest()?.contextModel).toBeNull()
    expect(indexes().index.documentChunks('docs/b.md')?.chunks[0]?.context).toBeNull()
  })

  it('never writes the plain index, and only a second file appears', async () => {
    await commit('initial')
    await sync(new RecordingProvider())
    closeIndexes()
    const plainPath = sourceIndexPath(dataDir, source.id)
    const before = readFileSync(plainPath)

    await contextualSync(new RecordingProvider(), contextualIndexes())
    contextual?.close()
    contextual = undefined

    expect(readFileSync(plainPath).equals(before)).toBe(true)
    expect(existsSync(variantIndexPath(dataDir, source.id, 'contextual'))).toBe(true)
  })

  it('reads every chunk again, and embeds nothing when nothing changed', async () => {
    await commit('initial')
    await contextualSync(new RecordingProvider(), contextualIndexes())

    const provider = new RecordingProvider()
    const report = await contextualSync(provider, contextualIndexes())
    expect(report.mode).toBe('full')
    expect(provider.embedded).toEqual([])
    expect(report.vectors.needed).toBe(0)
  })

  it('embeds again the chunk whose context changed, and only that one', async () => {
    await commit('initial')
    await contextualSync(new RecordingProvider(), contextualIndexes())
    const [changed] = contextualIndexes().index.documentChunks('docs/b.md')?.chunks ?? []
    if (changed === undefined) throw new Error('no chunk')

    const provider = new RecordingProvider()
    await contextualSync(
      provider,
      contextualIndexes(),
      (docs) =>
        new Map(
          docs.flatMap(({ chunks }) =>
            chunks.map(({ id }) => [
              id,
              id === changed.chunkId ? 'Another context.' : contextOf(id),
            ]),
          ),
        ),
    )
    expect(provider.embedded).toEqual([`Another context.\n\n${changed.text}`])
    const stored = contextualIndexes().index.documentChunks('docs/b.md')?.chunks[0]
    expect(stored?.context).toBe('Another context.')
    expect(contextualIndexes().index.searchKeywords('"Another context"', 5)).toHaveLength(1)
  })

  it('refuses a chunk with no context, rather than indexing it without one', async () => {
    await commit('initial')
    await expect(
      contextualSync(new RecordingProvider(), contextualIndexes(), () => new Map()),
    ).rejects.toThrow(/no context for /)
  })

  it('hands over every chunk, with its text and hash, for contexts to be found', async () => {
    await commit('initial')
    const seen: ContextDocument[] = []
    await contextualSync(new RecordingProvider(), contextualIndexes(), (docs) => {
      seen.push(...docs)
      return new Map(docs.flatMap(({ chunks }) => chunks.map(({ id }) => [id, contextOf(id)])))
    })
    expect(seen.map(({ path }) => path).sort()).toEqual(['docs/a.md', 'docs/b.md'])
    const doc = contextualIndexes().index.documentChunks('docs/a.md')
    expect(seen.find(({ path }) => path === 'docs/a.md')?.chunks.map(({ id }) => id)).toEqual(
      doc?.chunks.map(({ chunkId }) => chunkId),
    )
  })

  it('builds the control the same way, from the chunks headings and with no call', async () => {
    await commit('initial')
    const provider = new RecordingProvider()
    const control = openIndexes(dataDir, source.id, { variant: 'control' })
    try {
      await syncSource({
        source,
        provider,
        index: control.index,
        cache: control.cache,
        checkoutDir,
        meter: new UsageMeter(),
        contexts: {
          identity: CONTROL_IDENTITY,
          resolve: (documents) => Promise.resolve(controlContexts(documents)),
        },
      })
      const doc = control.index.documentChunks('docs/a.md')
      const first = doc?.chunks[0]
      expect(first?.context).toBe(headingPrefix('Doc A', ['First']))
      expect(doc?.chunks[1]?.context).toBe(headingPrefix('Doc A', ['Second']))
      expect(provider.embedded).toContain(`${first?.context ?? ''}\n\n${first?.text ?? ''}`)
      expect(control.index.getManifest()?.contextModel).toBe('heading-prefix:1')
      expect(existsSync(variantIndexPath(dataDir, source.id, 'contextual'))).toBe(false)
    } finally {
      control.close()
    }
  })

  it('reads the same documents without any index, for the estimate', async () => {
    const sha = await commit('initial')
    const documents = await contextDocumentsAt(source, checkoutDir, sha)
    expect(documents.map(({ path }) => path).sort()).toEqual(['docs/a.md', 'docs/b.md'])
    expect(existsSync(sourceIndexPath(dataDir, source.id))).toBe(false)
  })
})

describe('syncSource', { timeout: 60_000 }, () => {
  it('stores the anchors of every section a chunk contains', async () => {
    write('docs/nested.md', '# Nested\n\n## One\n\nFirst.\n\n## Two\n\nSecond.\n')
    await commit('initial')

    await sync(new RecordingProvider())

    const doc = indexes().index.documentChunks('docs/nested.md')
    expect(doc?.chunks.map((chunk) => chunk.metadata.anchors)).toEqual([['one', 'two']])
  })

  it('indexes a pinned commit instead of the head of the branch, and records it', async () => {
    const provider = new RecordingProvider()
    const pinned = await commit('initial')
    write('docs/a.md', docA('echo'))
    await commit('edit A')
    const { index, cache } = indexes()

    const report = await syncSource({
      source,
      provider,
      index,
      cache,
      checkoutDir,
      meter: new UsageMeter(),
      at: pinned,
    })

    expect(report.headSha).toBe(pinned)
    expect(index.getManifest()?.commitSha).toBe(pinned)
    expect(provider.embedded.join(' ')).toContain('delta')
    expect(provider.embedded.join(' ')).not.toContain('echo')
  })

  it('goes back to a pinned commit and returns to the head for free', async () => {
    const provider = new RecordingProvider()
    const pinned = await commit('initial')
    write('docs/a.md', docA('echo'))
    const head = await commit('edit A')
    await sync(provider)
    const { index, cache } = indexes()
    const textOfA = () =>
      index
        .documentChunks('docs/a.md')
        ?.chunks.map((chunk) => chunk.text)
        .join(' ') ?? ''

    const back = await syncSource({
      source,
      provider,
      index,
      cache,
      checkoutDir,
      meter: new UsageMeter(),
      at: pinned,
    })

    expect(back).toMatchObject({ mode: 'incremental', previousSha: head, headSha: pinned })
    expect(back.chunks.changed).toBe(1)
    expect(index.getManifest()?.commitSha).toBe(pinned)
    expect(textOfA()).toContain('delta')
    expect(textOfA()).not.toContain('echo')

    // Both versions of the chunk have been embedded by now: the way back costs nothing.
    provider.calls.length = 0
    const forward = await sync(provider)

    expect(forward).toMatchObject({ previousSha: pinned, headSha: head })
    expect(provider.embedded).toEqual([])
    expect(textOfA()).toContain('echo')
  })

  it('re-embeds only new and changed chunks on an incremental sync', async () => {
    const provider = new RecordingProvider()
    await commit('initial')

    // 1. The first sync embeds every chunk.
    const first = await sync(provider)
    expect(first).toMatchObject({
      mode: 'full',
      reason: 'no previous sync',
      documents: { added: 2, modified: 0, unchanged: 0, deleted: 0 },
      chunks: { added: 3, changed: 0, unchanged: 0, deleted: 0 },
      vectors: { needed: 3, embedded: 3, cached: 0 },
    })
    expect(provider.embedded).toHaveLength(3)
    const { index } = indexes()
    const aBefore = index.chunkHashes('docs/a.md')
    expect(aBefore.size).toBe(2)

    // 2. Edit one section of A, add C, delete B.
    write('docs/a.md', docA('echo'))
    write('docs/c.md', docC)
    rmSync(join(upstream, 'docs/b.md'))
    const head = await commit('edit A, add C, delete B')
    provider.calls.length = 0

    const second = await sync(provider)

    expect(second).toMatchObject({
      mode: 'incremental',
      reason: undefined,
      previousSha: first.headSha,
      headSha: head,
      documents: { added: 1, modified: 1, unchanged: 0, deleted: 1 },
      chunks: { added: 1, changed: 1, unchanged: 1, deleted: 1 },
      vectors: { needed: 2, embedded: 2, cached: 0 },
    })
    // Exactly A's changed chunk and C's chunk went to the provider.
    expect(provider.embedded).toHaveLength(2)
    expect(provider.embedded[0]).toContain('echo')
    expect(provider.embedded[0]).not.toContain('alpha')
    expect(provider.embedded[1]).toContain('charlie')

    // A's unchanged chunk kept its ID and hash; its changed chunk kept its ID.
    const aAfter = index.chunkHashes('docs/a.md')
    expect([...aAfter.keys()]).toEqual([...aBefore.keys()])
    const [firstId, secondId] = [...aBefore.keys()]
    expect(aAfter.get(firstId ?? '')).toBe(aBefore.get(firstId ?? ''))
    expect(aAfter.get(secondId ?? '')).not.toBe(aBefore.get(secondId ?? ''))

    // B is gone from chunks and chunks_vec; the manifest points at the new head.
    expect(index.documentPaths()).toEqual(['docs/a.md', 'docs/c.md'])
    const nearB = index.searchVectors(fakeVector(provider.embedded[1] ?? '', 8), 10)
    const nearPaths = [...index.chunksById(nearB.map((hit) => hit.chunkId)).values()].map(
      (hit) => hit.docPath,
    )
    expect(nearPaths).not.toContain('docs/b.md')
    expect(nearB).toHaveLength(3)
    expect(index.getManifest()?.commitSha).toBe(head)

    // The changed chunk is searchable by its new vector.
    const echo = index.searchVectors(fakeVector(provider.embedded[0] ?? '', 8), 1)[0]
    expect(echo?.chunkId).toBe(secondId)
    expect(echo?.score).toBeCloseTo(0, 5)
  })

  it('stores each chunk in document order, with the section it starts in', async () => {
    // Four small sections that do not fit together: two packs under the document root.
    const sections = ['One', 'Two', 'Three', 'Four']
      .map((heading) => `## ${heading}\n\n${paragraph(300, heading.toLowerCase())}`)
      .join('\n\n')
    write('docs/d.md', `# Doc D\n\n${sections}\n`)
    await commit('add D')

    await sync(new RecordingProvider())

    const stored = indexes().index.documentChunks('docs/d.md')
    expect(
      stored?.chunks.map((chunk) => [chunk.ordinal, chunk.headingPath, chunk.metadata.sectionPath]),
    ).toEqual([
      [0, [], ['One']],
      [1, [], ['Three']],
    ])
    // Each starts in a section of its own, so neither is a part of anything.
    expect(stored?.chunks.map((chunk) => chunk.metadata.part)).toEqual([null, null])
  })

  it('embeds nothing when nothing changed', async () => {
    const provider = new RecordingProvider()
    const head = await commit('initial')
    await sync(provider)
    provider.calls.length = 0

    const report = await sync(provider)

    expect(report).toMatchObject({
      mode: 'incremental',
      headSha: head,
      documents: { added: 0, modified: 0, unchanged: 0, deleted: 0 },
      vectors: { needed: 0, embedded: 0, cached: 0 },
    })
    expect(provider.calls).toEqual([])
  })

  it('makes zero writes to the keyword index when the corpus is unchanged, even on a full re-parse', async () => {
    // Regression test for migration 3: the version 2 trigger re-indexed every
    // chunk a sync upserted, so each full rebuild grew the index (6.2 to 9.0 MB
    // on the real TypeScript index).
    const provider = new RecordingProvider()
    await commit('initial')
    await sync(provider)
    const before = keywordIndexSnapshot()
    expect((JSON.parse(before) as unknown[][])[2]).toHaveLength(3) // one docsize row per chunk

    const incremental = await sync(provider)
    const full = await sync(provider, true)

    expect(incremental.mode).toBe('incremental')
    expect(full).toMatchObject({ mode: 'full', chunks: { unchanged: 3, changed: 0, added: 0 } })
    expect(keywordIndexSnapshot()).toBe(before)
    expect(provider.calls).toHaveLength(1) // only the first sync embedded anything
  })

  it('rebuilds a deleted index entirely from the embedding cache', async () => {
    const provider = new RecordingProvider()
    await commit('initial')
    await sync(provider)
    closeIndexes()
    rmSync(sourceIndexPath(dataDir, source.id))
    provider.calls.length = 0

    const report = await sync(provider)

    expect(report).toMatchObject({
      mode: 'full',
      reason: 'no previous sync',
      vectors: { needed: 3, embedded: 0, cached: 3 },
    })
    expect(provider.calls).toEqual([])
    expect(indexes().index.stats().chunks).toBe(3)
  })

  it('rebuilds after a chunker version change without embedding unchanged text', async () => {
    const provider = new RecordingProvider()
    await commit('initial')
    await sync(provider)
    const { index } = indexes()
    const manifest = index.getManifest()
    if (manifest === undefined) throw new Error('expected a manifest')
    index.applyChanges({
      documents: [],
      deletePaths: [],
      manifest: { ...manifest, chunkerVersion: 0 },
    })
    provider.calls.length = 0

    const report = await sync(provider)

    expect(report.mode).toBe('full')
    expect(report.reason).toMatch(/^chunker version changed from 0 to \d+$/)
    expect(report.chunks).toMatchObject({ unchanged: 3, added: 0, changed: 0 })
    expect(provider.calls).toEqual([])
  })

  it('re-parses everything after a parser version change, and embeds nothing for unchanged text', async () => {
    const provider = new RecordingProvider()
    await commit('initial')
    await sync(provider)
    provider.calls.length = 0
    source = { ...source, parserVersion: 2 }

    const report = await sync(provider)

    expect(report).toMatchObject({
      mode: 'full',
      reason: 'parser version changed from 1 to 2',
      documents: { added: 0, modified: 0, unchanged: 2, deleted: 0 },
      chunks: { added: 0, changed: 0, unchanged: 3, deleted: 0 },
      vectors: { needed: 0, embedded: 0, cached: 0 },
    })
    expect(provider.calls).toEqual([])
    expect(indexes().index.getManifest()?.parserVersion).toBe(2)

    // The next sync is incremental again.
    expect((await sync(provider)).mode).toBe('incremental')
  })

  it('re-embeds only the chunks a new parser version changes', async () => {
    const provider = new RecordingProvider()
    await commit('initial')
    await sync(provider)
    provider.calls.length = 0
    // The new parser renders doc B differently and leaves doc A alone.
    const parse = source.parse.bind(source)
    source = {
      ...source,
      parserVersion: 2,
      parse: async (file, ctx) => {
        const doc = await parse(file, ctx)
        return file.path.endsWith('b.md') ? { ...doc, title: 'Doc B, renamed' } : doc
      },
    }

    const report = await sync(provider)

    expect(report.chunks).toMatchObject({ changed: 1, unchanged: 2 })
    expect(provider.embedded).toHaveLength(1)
    expect(provider.embedded[0]).toContain('Doc B, renamed')
  })

  it('treats an index from before parser versions as a parser change', async () => {
    const provider = new RecordingProvider()
    await commit('initial')
    await sync(provider)
    const { index } = indexes()
    const manifest = index.getManifest()
    if (manifest === undefined) throw new Error('expected a manifest')
    index.applyChanges({
      documents: [],
      deletePaths: [],
      manifest: { ...manifest, parserVersion: null },
    })
    provider.calls.length = 0

    const report = await sync(provider)

    expect(report.reason).toBe('parser version changed from none to 1')
    expect(provider.calls).toEqual([])
  })

  it('rebuilds when the include paths change', async () => {
    const provider = new RecordingProvider()
    write('extra/x.md', `# X\n\n${paragraph(50, 'xray')}\n`)
    await commit('initial')
    await sync(provider)
    provider.calls.length = 0
    source = demoSource(source.repo, ['docs', 'extra'])

    const report = await sync(provider)

    expect(report).toMatchObject({ mode: 'full', reason: 'include paths changed' })
    expect(report.documents.added).toBe(1)
    expect(provider.embedded).toHaveLength(1)
    expect(provider.embedded[0]).toContain('xray')
  })

  it('re-embeds everything into a new vector table when the embedding model changes', async () => {
    await commit('initial')
    await sync(new RecordingProvider({ dimensions: 8 }))
    const smaller = new RecordingProvider({ dimensions: 4 })

    const report = await sync(smaller)

    expect(report.reason).toBe('embedding model changed from fake:hash:8 to fake:hash:4')
    expect(report.vectors).toEqual({ needed: 3, embedded: 3, cached: 0 })
    const { index } = indexes()
    expect(index.getManifest()).toMatchObject({ embedModel: 'fake:hash:4', embedDimensions: 4 })
    expect(index.searchVectors(fakeVector(smaller.embedded[0] ?? '', 4), 1)).toHaveLength(1)
  })

  it('batches embedding requests within the provider limits', async () => {
    const provider = new RecordingProvider({ maxInputs: 2 })
    write('docs/c.md', docC)
    await commit('initial')

    await sync(provider)

    expect(provider.calls.map((call) => call.texts.length)).toEqual([2, 2])
    expect(provider.calls.every((call) => call.inputType === 'document')).toBe(true)
  })
})
