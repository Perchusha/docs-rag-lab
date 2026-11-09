// The documents the interview bank covers, from a source's index (ADR-0018). The source says which
// documents are in the topic map and where; core reads no source's paths.
import type { SourceIndex } from '@docs-rag-lab/db'
import {
  DOC_TYPES,
  type CompilerOutput,
  type DocType,
  type InterviewTopic,
  type Source,
} from '@docs-rag-lab/source-kit'

export interface BankChunk {
  id: string
  text: string
  textHash: string
  /** The fragment of the section the chunk starts in, '' for none. */
  anchor: string
  /** The headings of the section the chunk starts in. */
  sectionPath: string[]
  /** The fragments of every section the chunk contains, in order, as the chunker records them. */
  anchors: string[]
  /** Character ranges of the rendered blocks in `text`. */
  spans: [number, number][]
  /** What the compiler said of the chunk's examples, in the compiled index only. */
  compiler: CompilerOutput[]
}

export interface BankDocument {
  path: string
  url: string
  title: string
  docType: DocType
  topic: InterviewTopic
  chunks: BankChunk[]
}

const isDocType = (value: string): value is DocType =>
  (DOC_TYPES as readonly string[]).includes(value)

const stringsOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []

function spansOf(value: unknown): [number, number][] {
  if (!Array.isArray(value)) return []
  return value.flatMap((span): [number, number][] =>
    Array.isArray(span) && typeof span[0] === 'number' && typeof span[1] === 'number'
      ? [[span[0], span[1]]]
      : [],
  )
}

const compilerOf = (value: unknown): CompilerOutput[] =>
  Array.isArray(value) ? (value as CompilerOutput[]) : []

/** What the bank reads of an index. */
export type BankIndex = Pick<SourceIndex, 'documentPaths' | 'documentChunks' | 'chunkHashes'>

/** The documents the source places in its topic map, with their chunks in document order. */
export function bankDocuments(source: Source, index: BankIndex): BankDocument[] {
  if (source.interviewTopic === undefined) return []
  const documents: BankDocument[] = []
  for (const path of index.documentPaths()) {
    const stored = index.documentChunks(path)
    if (stored === undefined || !isDocType(stored.docType)) continue
    const topic = source.interviewTopic({ path, docType: stored.docType, title: stored.title })
    if (topic === undefined) continue
    const hashes = index.chunkHashes(path)
    documents.push({
      path,
      url: stored.url,
      title: stored.title,
      docType: stored.docType,
      topic,
      chunks: stored.chunks.map((chunk) => ({
        id: chunk.chunkId,
        text: chunk.text,
        textHash: hashes.get(chunk.chunkId) ?? '',
        anchor: chunk.anchor,
        sectionPath: stringsOf(chunk.metadata.sectionPath),
        anchors: stringsOf(chunk.metadata.anchors),
        spans: spansOf(chunk.metadata.spans),
        compiler: compilerOf(chunk.metadata.compiler),
      })),
    })
  }
  return documents.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

/** The page and section a chunk's answer is in. */
export function citationUrl(
  document: Pick<BankDocument, 'url'>,
  chunk: Pick<BankChunk, 'anchor'>,
): string {
  return chunk.anchor === '' ? document.url : `${document.url}#${chunk.anchor}`
}
