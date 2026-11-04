// What the reranker would change on one search (ADR-0014). The numbers come from a rerank trace, and
// this only says them, so the view stays thin.
import type { RetrievalTrace } from '@docs-rag-lab/contracts'

export type RerankChange = 'came in' | 'left'

export interface RerankRow {
  chunkId: string
  /** 1-based, after the rerank. */
  rank: number
  /** 1-based, in the fused ranking. */
  was: number
  score: number
  /** Whether it crosses the line into or out of what goes to an answer. */
  change: RerankChange | undefined
}

/** The scored chunks, best first. Empty for a trace that has no rerank. */
export function rerankRows(trace: RetrievalTrace): RerankRow[] {
  const { topK } = trace.params
  return (trace.rerank?.ranked ?? []).map(({ chunkId, rank, fusedRank, score }) => ({
    chunkId,
    rank,
    was: fusedRank,
    score,
    change:
      fusedRank > topK && rank <= topK
        ? 'came in'
        : fusedRank <= topK && rank > topK
          ? 'left'
          : undefined,
  }))
}

/** "6 chunks would come into the top 8, and 6 would leave." */
export function rerankSummary(rows: readonly RerankRow[], topK: number): string {
  const cameIn = rows.filter(({ change }) => change === 'came in').length
  const left = rows.filter(({ change }) => change === 'left').length
  if (cameIn === 0 && left === 0) {
    const reordered = rows.some(({ rank, was }) => rank <= topK && rank !== was)
    return `The same chunks would stay in the top ${String(topK)}, in ${reordered ? 'another' : 'the same'} order.`
  }
  const chunks = cameIn === 1 ? '1 chunk' : `${String(cameIn)} chunks`
  return `${chunks} would come into the top ${String(topK)}, and ${String(left)} would leave.`
}

/** Where the scores came from, in words. */
export function rerankSource(trace: RetrievalTrace, ms: string): string {
  const { rerank } = trace
  if (rerank === undefined) return ''
  const how = rerank.from === 'cache' ? 'from the cache' : `in ${ms}`
  const waited = rerank.rateLimitRetries === 0 ? '' : ', after waiting out a rate limit'
  return `${rerank.provider} scored the fused top ${String(rerank.ranked.length)} in one call, ${how}${waited}.`
}
