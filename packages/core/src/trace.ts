// The retrieval trace (SPEC section 9): every candidate list with ranks and
// scores, the fused ranking, timings and the final context. It is plain,
// serializable data with a version, so eval can store it as JSON and the M3
// inspector can render it. Bump TRACE_VERSION when its shape changes.
import type { DocType } from '@docs-rag-lab/source-kit'

import type { ExactToken } from './query.ts'
import type { FusedCandidate } from './rrf.ts'

export const TRACE_VERSION = 1

export type Strategy = 'vector' | 'hybrid'

export const STRATEGIES: readonly Strategy[] = ['vector', 'hybrid']

/** vector: KNN over embeddings. keyword: BM25 over the question's terms. exact: BM25 over its exact tokens. */
export type ListName = 'vector' | 'keyword' | 'exact'

export interface TraceCandidate {
  chunkId: string
  /** 1-based. */
  rank: number
  score: number
}

export interface TraceList {
  name: ListName
  /** cosine-distance: lower is better. bm25: FTS5 BM25 with the sign flipped, higher is better. */
  scoring: 'cosine-distance' | 'bm25'
  /** The FTS5 query, for keyword and exact lists. */
  query?: string
  /** Why the list did not run. A skipped list has no candidates and no part in fusion. */
  skipped?: string
  ms: number
  candidates: TraceCandidate[]
}

export type TraceFusion =
  { method: 'none' } | { method: 'rrf'; k: number; ms: number; ranked: FusedCandidate<ListName>[] }

/** What a candidate is, for every chunk that appears in any list. */
export interface TraceChunk {
  docPath: string
  title: string
  headingPath: string[]
  anchor: string
  docType: string
  tokenCount: number
}

/** One chunk of the final context, as it goes to generation. */
export interface TraceContextChunk {
  rank: number
  chunkId: string
  /** The citation source and title the answer request uses. */
  source: string
  title: string
  text: string
}

export interface RetrievalTrace {
  version: typeof TRACE_VERSION
  question: string
  sourceId: string
  strategy: Strategy
  params: { topK: number; candidates: number; rrfK: number }
  filters: { docTypes: DocType[] }
  query: { terms: string[]; exactTokens: ExactToken[] }
  embedding: { provider: string; from: 'cache' | 'api'; ms: number }
  lists: TraceList[]
  fusion: TraceFusion
  chunks: Record<string, TraceChunk>
  context: TraceContextChunk[]
  totalMs: number
}
