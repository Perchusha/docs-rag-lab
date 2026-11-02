// A document split into its chunks, for the inspector's chunk-boundary view.
import type { SectionPart } from './trace.ts'

export interface DocumentChunk {
  chunkId: string
  /** 0-based position in the document. */
  ordinal: number
  /** The section the chunk belongs to; for a pack of sections, their common parent. */
  headingPath: string[]
  /** The section the chunk starts in, which `anchor` points to. */
  sectionPath: string[]
  /** Which part of its section the chunk is, or null when it is the only one. */
  part: SectionPart | null
  anchor: string
  tokenCount: number
  /** The heading-path prefix line, then the rendered blocks. */
  text: string
  /** Character ranges of the rendered blocks in `text`. */
  spans: [number, number][]
  /** The contextual retrieval prefix (M5), or null. */
  context: string | null
}

export interface DocumentChunks {
  sourceId: string
  path: string
  url: string
  title: string
  docType: string
  chunks: DocumentChunk[]
}
