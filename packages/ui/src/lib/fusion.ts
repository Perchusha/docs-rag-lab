// The inspector's fusion view as data (SPEC section 9, ADR-0005). One row per
// fused candidate: its rank and score in each list, what each list added to
// its RRF score, and how far fusion moved it from its vector rank. Pure, and
// tested against real traces.
import {
  LIST_NAMES,
  type ListName,
  type RetrievalTrace,
  type TraceChunk,
  type TraceList,
} from '@docs-rag-lab/contracts'

export interface ListCell {
  rank: number
  /** The list's own score: cosine distance or BM25. */
  score: number
  /** This list's part of the RRF score: 1 / (k + rank). */
  contribution: number
}

export interface FusionRow {
  chunkId: string
  chunk: TraceChunk | undefined
  fusedRank: number
  rrfScore: number
  cells: Partial<Record<ListName, ListCell>>
  /**
   * Vector rank minus fused rank: positive when fusion moved the chunk up, negative
   * when it moved it down. 'new' when vector search did not return it at all.
   */
  delta: number | 'new'
  /** The fused rank is within top K: the chunk went to the answer. */
  inContext: boolean
  /** In both BM25 lists, so BM25 adds to its score twice. */
  bm25Twice: boolean
}

export function listOf(trace: RetrievalTrace, name: ListName): TraceList | undefined {
  return trace.lists.find((list) => list.name === name)
}

/** The rows of the fused ranking, best first. Empty when there was no fusion (vector strategy). */
export function fusionRows(trace: RetrievalTrace): FusionRow[] {
  if (trace.fusion.method !== 'rrf') return []
  const { k, ranked } = trace.fusion
  const scores = new Map<string, number>()
  for (const list of trace.lists) {
    for (const candidate of list.candidates) {
      scores.set(`${list.name}:${candidate.chunkId}`, candidate.score)
    }
  }
  return ranked.map((entry) => {
    const cells: Partial<Record<ListName, ListCell>> = {}
    for (const name of LIST_NAMES) {
      const rank = entry.ranks[name]
      if (rank === undefined) continue
      cells[name] = {
        rank,
        score: scores.get(`${name}:${entry.chunkId}`) ?? Number.NaN,
        contribution: 1 / (k + rank),
      }
    }
    const vectorRank = cells.vector?.rank
    return {
      chunkId: entry.chunkId,
      chunk: trace.chunks[entry.chunkId],
      fusedRank: entry.rank,
      rrfScore: entry.score,
      cells,
      delta: vectorRank === undefined ? 'new' : vectorRank - entry.rank,
      inContext: entry.rank <= trace.params.topK,
      bm25Twice: cells.keyword !== undefined && cells.exact !== undefined,
    }
  })
}

/** The most an RRF score can be: first in every list. Contribution bars are drawn against it. */
export function maxRrfScore(trace: RetrievalTrace): number {
  const k = trace.fusion.method === 'rrf' ? trace.fusion.k : trace.params.rrfK
  const lists = trace.lists.filter((list) => list.skipped === undefined).length
  return lists / (k + 1)
}

/** Exact tokens that are also search terms: BM25 matches them through both lists. */
export function doubledTokens(trace: RetrievalTrace): string[] {
  const terms = new Set(trace.query.terms.map((term) => term.toLowerCase()))
  return trace.query.exactTokens
    .map((exact) => exact.token)
    .filter((token) => terms.has(token.toLowerCase()))
}

export interface DoubleCounting {
  /** Exact tokens that are also terms, if any. */
  tokens: string[]
  /** Chunks in the context that are in both BM25 lists. */
  inContext: number
  topK: number
}

/** Whether BM25 counted twice for any chunk in the context, for the banner. */
export function doubleCounting(
  trace: RetrievalTrace,
  rows: readonly FusionRow[],
): DoubleCounting | undefined {
  const inContext = rows.filter((row) => row.inContext && row.bm25Twice).length
  if (inContext === 0) return undefined
  return { tokens: doubledTokens(trace), inContext, topK: trace.params.topK }
}

export type SortKey = 'fused' | ListName
export type SortDirection = 'ascending' | 'descending'

function rankOf(row: FusionRow, key: SortKey): number | undefined {
  return key === 'fused' ? row.fusedRank : row.cells[key]?.rank
}

/**
 * Rows by their rank in one list. Chunks the list did not return go last in
 * either direction, in fused order; ties also keep fused order.
 */
export function sortRows(
  rows: readonly FusionRow[],
  key: SortKey,
  direction: SortDirection,
): FusionRow[] {
  const sign = direction === 'ascending' ? 1 : -1
  return [...rows].sort((a, b) => {
    const ra = rankOf(a, key)
    const rb = rankOf(b, key)
    if (ra === undefined || rb === undefined) {
      if (ra !== rb) return ra === undefined ? 1 : -1
      return a.fusedRank - b.fusedRank
    }
    return sign * (ra - rb) || a.fusedRank - b.fusedRank
  })
}
