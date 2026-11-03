// An eval report (SPEC section 10, ADR-0010): core's harness produces it, the
// CLI writes it to eval/reports/ and the dashboard renders it. It is split by what
// may differ between two runs of the same thing: `identity` says what was
// measured, `result` what came out, and `run` holds what is never compared. Reports
// hold chunk IDs and ranks, not chunk text. The full trace of any question can be
// recomputed from `identity`. Bump EVAL_REPORT_VERSION only when an existing field
// changes its meaning. A new section is optional and needs no bump, so the reports
// already committed stay readable.
import type { Strategy } from './trace.ts'
import type { Parsed } from './requests.ts'

export const EVAL_REPORT_VERSION = 1

/** The k of hit@k. The context that reaches the answer is the top 8. */
export const HIT_CUTOFFS = [1, 3, 5, 8] as const

export type HitCutoff = (typeof HIT_CUTOFFS)[number]

/** How many questions have an anchor in the top k, by k. */
export type HitCounts = Record<HitCutoff, number>

export interface RankMetrics {
  hits: HitCounts
  /** The mean reciprocal rank of the best anchor, 0 for a question with none in any list. */
  mrr: number
}

export interface EvalMetrics {
  /** The questions these numbers count. */
  questions: number
  /** The headline: primary anchors only (ADR-0009, section 9). */
  primary: RankMetrics
  /** The mean share of primary anchors in the top 8. */
  recallAt8: number
  /** Secondary: primary or acceptable anchors. */
  withAcceptable: RankMetrics
}

export interface EvalAnchorRank {
  /** The anchor as the golden set's lock names it: path, fragment and pin. */
  anchor: string
  role: 'primary' | 'acceptable'
  /** 1-based, or null when no candidate list has it. */
  rank: number | null
}

/** One question under one strategy. */
export interface EvalQuestionScore {
  id: string
  tags: string[]
  anchors: EvalAnchorRank[]
  /** The best rank among primary anchors. */
  primaryRank: number | null
  /** The best rank among primary and acceptable anchors. */
  acceptableRank: number | null
  recallAt8: number
  /** The chunk IDs of the context, in order. */
  context: string[]
}

export interface EvalStrategyResult {
  strategy: Strategy
  overall: EvalMetrics
  byTag: Record<string, EvalMetrics>
  questions: EvalQuestionScore[]
}

/** The metrics a comparison looks at, per question. */
export const COMPARED_METRICS = ['hit@1', 'hit@3', 'hit@5', 'hit@8', 'recall@8', 'mrr'] as const

export type ComparedMetric = (typeof COMPARED_METRICS)[number]

/**
 * What a difference means. a or b: that side is better, beyond what chance would
 * explain. noise: the sides differ by one or two questions. not-significant: by more,
 * but p >= 0.05. mixed: significant, but the side that won more questions does not
 * have the higher total, so neither is simply better. too-few: the scope has so few
 * questions that no result could be significant.
 */
export type DifferenceVerdict = 'a' | 'b' | 'noise' | 'not-significant' | 'mixed' | 'too-few'

/** One metric, compared question by question. */
export interface MetricDifference {
  metric: ComparedMetric
  /** A count for hit@k, a mean for recall@8 and MRR. */
  a: number
  b: number
  /** The questions on which each side scored higher. */
  aBetter: number
  bBetter: number
  tied: number
  /** Exact two-sided sign test over the questions that differ. */
  p: number
  verdict: DifferenceVerdict
}

export interface ScopeComparison {
  /** 'overall', or a tag. */
  scope: string
  questions: number
  primary: MetricDifference[]
  withAcceptable: MetricDifference[]
}

export interface EvalComparison {
  a: string
  b: string
  scopes: ScopeComparison[]
}

/** A rank a question should reach (SPEC section 13). */
export interface EvalTargetResult {
  questionId: string
  anchor: string
  /** The rank to reach or beat. */
  target: number
  /** The rank each strategy has now, or null. */
  ranks: Partial<Record<Strategy, number | null>>
  /** Whether the default strategy reaches it, or null when that strategy did not run. */
  met: boolean | null
}

export interface EvalResult {
  /** The questions the metrics count: they have anchors and are not stale. */
  scored: number
  stale: string[]
  /** Questions a human should re-read. They are scored all the same. */
  review: string[]
  /** Questions with no anchors, which retrieval metrics leave out. */
  unanswerable: string[]
  strategies: EvalStrategyResult[]
  /** Present when two strategies ran. */
  comparison: EvalComparison | null
  targets: EvalTargetResult[]
  /** A readable name for every chunk in a context. */
  chunks: Record<string, { label: string; docPath: string }>
}

/** What was measured. Two reports with different identities are not comparable. */
export interface EvalIdentity {
  sourceId: string
  docs: { repo: string; branch: string; sha: string }
  chunkerVersion: number
  parserVersion: number | null
  /** The index's migration version: a change here can change what keyword search finds. */
  indexSchema: number
  embedModel: string
  /** The model of the contextual retrieval prefixes (M5), or null. */
  contextModel: string | null
  /** A hash of every chunk's ID, text hash and context, so the same SHA is known to mean the same corpus. */
  chunksHash: string
  goldenSet: { version: number; hash: string }
  /** Bumped when the code changes what a search ranks for the same settings. */
  retrievalVersion: number
  /** Every retrieval setting but the strategy, which is per result. */
  retrieval: Record<string, string | number | boolean>
}

/** The vectors behind a result. The same text can get different vectors (ADR-0010). */
export interface EvalVectors {
  queryHash: string
  corpusHash: string
}

/** What is true of this run alone. */
export interface EvalRunInfo {
  /** The name of a committed run, such as baseline. Null for a development run. */
  name: string | null
  createdAt: string
  repoSha: string
  repoDirty: boolean
  timings: Partial<Record<Strategy, { meanMs: number; maxMs: number }>>
  usage: { embeddingTokens: number; embeddingRequests: number }
}

export interface EvalReport {
  version: typeof EVAL_REPORT_VERSION
  identity: EvalIdentity
  vectors: EvalVectors
  result: EvalResult
  run: EvalRunInfo
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * A parsed JSON file as an EvalReport, or why it is not one. It checks the version
 * and the outline, not every number: reports are files this repository wrote, and
 * this is what stops a report of another version from being read as this one.
 */
export function parseEvalReport(value: unknown): Parsed<EvalReport> {
  if (!isRecord(value)) return { ok: false, error: 'a report must be a JSON object' }
  if (value.version !== EVAL_REPORT_VERSION) {
    return {
      ok: false,
      error: `this report has version ${JSON.stringify(value.version)}, and this code reads version ${String(EVAL_REPORT_VERSION)}`,
    }
  }
  const { identity, vectors, result, run } = value
  if (!isRecord(identity) || !isRecord(identity.goldenSet) || !isRecord(identity.docs)) {
    return { ok: false, error: 'a report needs identity, with docs and goldenSet' }
  }
  if (!isRecord(vectors)) return { ok: false, error: 'a report needs vectors' }
  if (!isRecord(result) || !Array.isArray(result.strategies) || !Array.isArray(result.targets)) {
    return { ok: false, error: 'a report needs result, with strategies and targets' }
  }
  if (!isRecord(run) || typeof run.repoSha !== 'string') {
    return { ok: false, error: 'a report needs run, with repoSha' }
  }
  return { ok: true, value: value as unknown as EvalReport }
}
