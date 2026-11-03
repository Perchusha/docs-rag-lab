// Retrieval metrics (SPEC section 10): pure functions over a ranking. An anchor is
// found at the best rank of any chunk it resolves to. Reports are compared byte for
// byte, so means are rounded and tags sorted (ADR-0010).
import {
  HIT_CUTOFFS,
  type EvalAnchorRank,
  type EvalMetrics,
  type EvalQuestionScore,
  type EvalStrategyResult,
  type HitCounts,
  type RankMetrics,
  type RetrievalTrace,
  type Strategy,
} from '@docs-rag-lab/contracts'

import { anchorKey, type AnchorRef, type GoldenQuestion } from './golden.ts'

/** The context that reaches the answer: the top 8, which recall@8 counts. */
export const CONTEXT_CUTOFF = 8

/** Means to 6 places: enough to read, and the same on every platform. */
export function roundMean(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

/** Every chunk a strategy ranked, best first: the fused list, or the vector list without fusion. */
export function rankingOf(trace: RetrievalTrace): string[] {
  if (trace.fusion.method === 'rrf') return trace.fusion.ranked.map((entry) => entry.chunkId)
  return trace.lists[0]?.candidates.map((candidate) => candidate.chunkId) ?? []
}

/** The best 1-based rank of any of these chunks, or null when the ranking has none. */
export function bestRank(chunkIds: readonly string[], ranking: readonly string[]): number | null {
  const ranks = chunkIds.map((id) => ranking.indexOf(id) + 1).filter((rank) => rank > 0)
  return ranks.length === 0 ? null : Math.min(...ranks)
}

function best(ranks: readonly (number | null)[]): number | null {
  const found = ranks.filter((rank) => rank !== null)
  return found.length === 0 ? null : Math.min(...found)
}

/** Scores one question against a ranking. `chunksOf` says what each anchor resolved to. */
export function scoreQuestion(
  question: GoldenQuestion,
  ranking: readonly string[],
  context: readonly string[],
  chunksOf: (anchor: AnchorRef) => readonly string[],
): EvalQuestionScore {
  const rankOf = (anchor: AnchorRef, role: EvalAnchorRank['role']): EvalAnchorRank => ({
    anchor: anchorKey(anchor),
    role,
    rank: bestRank(chunksOf(anchor), ranking),
  })
  const primary = question.primary.map((anchor) => rankOf(anchor, 'primary'))
  const acceptable = question.acceptable.map((anchor) => rankOf(anchor, 'acceptable'))
  const found = primary.filter(({ rank }) => rank !== null && rank <= CONTEXT_CUTOFF).length
  const recallAt8 =
    question.primaryMatch === 'any' ? (found > 0 ? 1 : 0) : found / Math.max(primary.length, 1)
  return {
    id: question.id,
    tags: [...question.tags].sort(),
    anchors: [...primary, ...acceptable],
    primaryRank: best(primary.map(({ rank }) => rank)),
    acceptableRank: best([...primary, ...acceptable].map(({ rank }) => rank)),
    recallAt8: roundMean(recallAt8),
    context: [...context],
  }
}

export function reciprocal(rank: number | null): number {
  return rank === null ? 0 : 1 / rank
}

function rankMetrics(ranks: readonly (number | null)[]): RankMetrics {
  const hit = (k: number): number => ranks.filter((rank) => rank !== null && rank <= k).length
  const hits = Object.fromEntries(HIT_CUTOFFS.map((k) => [k, hit(k)])) as HitCounts
  const total = ranks.reduce((sum: number, rank) => sum + reciprocal(rank), 0)
  return { hits, mrr: roundMean(total / Math.max(ranks.length, 1)) }
}

/** The metrics of a group of questions. An empty group counts zero, not NaN. */
export function metricsOf(scores: readonly EvalQuestionScore[]): EvalMetrics {
  const recall = scores.reduce((sum, score) => sum + score.recallAt8, 0)
  return {
    questions: scores.length,
    primary: rankMetrics(scores.map((score) => score.primaryRank)),
    recallAt8: roundMean(recall / Math.max(scores.length, 1)),
    withAcceptable: rankMetrics(scores.map((score) => score.acceptableRank)),
  }
}

/** The tags these questions use, sorted, so a report's order never depends on the file's. */
export function tagsOf(scores: readonly EvalQuestionScore[]): string[] {
  return [...new Set(scores.flatMap((score) => score.tags))].sort()
}

export function strategyResult(
  strategy: Strategy,
  scores: readonly EvalQuestionScore[],
): EvalStrategyResult {
  const byTag = Object.fromEntries(
    tagsOf(scores).map((tag) => [
      tag,
      metricsOf(scores.filter((score) => score.tags.includes(tag))),
    ]),
  )
  const questions = [...scores].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return { strategy, overall: metricsOf(scores), byTag, questions }
}
