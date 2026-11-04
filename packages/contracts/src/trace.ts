// The retrieval trace (SPEC section 9): every candidate list with ranks and
// scores, the fused ranking, timings and the final context. It is plain,
// serializable data with a version: core produces it, the CLI prints it, the
// inspector renders it and eval stores it (ADR-0006). Bump TRACE_VERSION when
// its shape changes.
//
// 1: M2.
// 2: TraceChunk.sectionPath, the section a chunk starts in (M3).
// 3: TraceChunk.part, which part of its section a chunk is (M3).
// 4: the rerank strategy and RetrievalTrace.rerank (M5).
// 5: TraceRerank.rateLimitRetries (M5).

export const TRACE_VERSION = 5

/** vector: KNN over embeddings. hybrid: lists fused by RRF. rerank: hybrid, with the top of it reranked. */
export type Strategy = 'vector' | 'hybrid' | 'rerank'

export const STRATEGIES: readonly Strategy[] = ['vector', 'hybrid', 'rerank']

/** The strategies that search this machine's index, with no call beyond the query's vector. */
export const LOCAL_STRATEGIES: readonly Strategy[] = ['vector', 'hybrid']

/** vector: KNN over embeddings. keyword: BM25 over the question's terms. exact: BM25 over its exact tokens. */
export type ListName = 'vector' | 'keyword' | 'exact'

export const LIST_NAMES: readonly ListName[] = ['vector', 'keyword', 'exact']

/** Where an exact token came from: code in backticks, a camelCase identifier, a --flag, or the source's own hook. */
export type ExactTokenOrigin = 'backticks' | 'identifier' | 'flag' | 'source'

export interface ExactToken {
  token: string
  from: ExactTokenOrigin
}

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

/** One entry of the fused ranking. */
export interface TraceFusedCandidate {
  chunkId: string
  /** 1-based position in the fused ranking. */
  rank: number
  /** The RRF score: the sum of 1 / (k + rank) over the lists the chunk is in. */
  score: number
  /** The chunk's 1-based rank in each list it appears in. */
  ranks: Partial<Record<ListName, number>>
}

export type TraceFusion =
  { method: 'none' } | { method: 'rrf'; k: number; ms: number; ranked: TraceFusedCandidate[] }

/** One candidate the reranker scored. */
export interface TraceRerankedCandidate {
  chunkId: string
  /** 1-based position after the rerank. */
  rank: number
  /** The reranker's relevance score: higher is better. */
  score: number
  /** 1-based position in the fused ranking, before the rerank. */
  fusedRank: number
}

/** What the reranker did to the top of the fused ranking (ADR-0014). */
export interface TraceRerank {
  /** Provider and model, for example voyage:rerank-3. */
  provider: string
  /** How deep it was asked to score. There may be fewer candidates. */
  depth: number
  /** Whether its one call came from the cache. */
  from: 'cache' | 'api'
  /** How many 429s that call survived, also when it is replayed from the cache. */
  rateLimitRetries: number
  ms: number
  /** The scored candidates, best first. Below them the fused order goes on. */
  ranked: TraceRerankedCandidate[]
}

/** Which of the chunks that start in one section this one is. 1-based. */
export interface SectionPart {
  index: number
  total: number
}

/**
 * A chunk's label: the document title, the section it starts in, and which part
 * of that section it is, since the chunks of a long section otherwise read the
 * same. The CLI, the citations and ui all use this one wording.
 */
export function chunkLabel(chunk: {
  title: string
  sectionPath: readonly string[]
  part: SectionPart | null
}): string {
  const label = [chunk.title, ...chunk.sectionPath].join(' > ')
  return chunk.part === null
    ? label
    : `${label} (part ${String(chunk.part.index)} of ${String(chunk.part.total)})`
}

/** What a candidate is, for every chunk that appears in any list. */
export interface TraceChunk {
  docPath: string
  title: string
  /** The section the chunk belongs to; for a pack of sections, their common parent. */
  headingPath: string[]
  /** The section the chunk starts in, which `anchor` points to. Label chunks with this. */
  sectionPath: string[]
  /** Which part of its section the chunk is, or null when it is the only one. */
  part: SectionPart | null
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
  filters: { docTypes: string[] }
  query: { terms: string[]; exactTokens: ExactToken[] }
  embedding: { provider: string; from: 'cache' | 'api'; ms: number }
  lists: TraceList[]
  fusion: TraceFusion
  /** Only under the rerank strategy. */
  rerank?: TraceRerank
  chunks: Record<string, TraceChunk>
  context: TraceContextChunk[]
  totalMs: number
}
