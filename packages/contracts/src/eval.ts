// An eval report (SPEC section 10, ADR-0010): core's harness produces it, the
// CLI writes it to eval/reports/ and the dashboard renders it. It is split by what
// may differ between two runs of the same thing: `identity` says what was
// measured, `result` what came out, and `run` holds what is never compared. Reports
// hold chunk IDs and ranks, not chunk text. The full trace of any question can be
// recomputed from `identity`. Bump EVAL_REPORT_VERSION only when an existing field
// changes its meaning. A new section is optional and needs no bump, so the reports
// already committed stay readable.
import type {
  AnswerRow,
  AnswerStatus,
  EvalAnswers,
  EvalCalibration,
  EvalSourceAbout,
  EvalSpotCheck,
  EvalVerifyRecord,
} from './eval-answers.ts'
import type { DifferenceVerdict } from './eval-difference.ts'
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

export type { DifferenceVerdict }

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
  /** The model and prompt hash of the contextual retrieval prefixes (ADR-0014), or null. */
  contextModel: string | null
  /** A hash of every chunk's ID, text hash and context, so the same SHA is known to mean the same corpus. */
  chunksHash: string
  goldenSet: { version: number; hash: string }
  /** Bumped when the code changes what a search ranks for the same settings. */
  retrievalVersion: number
  /** Every retrieval setting but the strategy, which is per result. */
  retrieval: Record<string, string | number | boolean>
  /** Only in a report that measured the rerank strategy, so earlier reports stay comparable. */
  rerank?: { model: string; depth: number }
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
  /** Only in a report that measured rerank. A run that survived 429s says so here. */
  rerank?: { calls: number; rateLimitRetries: number }
}

export interface EvalReport {
  version: typeof EVAL_REPORT_VERSION
  identity: EvalIdentity
  vectors: EvalVectors
  result: EvalResult
  run: EvalRunInfo
  /** Answers and verdicts, when the run was asked for them. Never compared by verify. */
  answers?: EvalAnswers
}

/** The metrics a pooled test reads (ADR-0019). */
export const POOLED_METRICS = ['fully-correct', 'citations-hold', 'not-wrongly-refused'] as const

export type PooledMetric = (typeof POOLED_METRICS)[number]

/** One metric over the questions of several reports together. */
export interface EvalPooledMetric {
  metric: PooledMetric
  questions: number
  aBetter: number
  bBetter: number
  tied: number
  p: number
  /** Questions on which each row's two answers differ, or null for a row answered once. */
  runToRun: { a: number | null; b: number | null }
  /** The sign test's verdict, read against twice the larger run-to-run count (ADR-0013). */
  verdict: DifferenceVerdict
}

/**
 * Two rows compared over several reports' questions together, as ADR-0019's test reads them:
 * `drl eval pool`. It reads committed reports and calls nothing.
 */
export interface EvalPooled {
  /** The reports pooled, in the order given. */
  reports: {
    sourceId: string
    name: string | null
    repoSha: string
    createdAt: string
    goldenSet: { version: number; hash: string }
  }[]
  a: AnswerRow
  b: AnswerRow
  metrics: EvalPooledMetric[]
  /** First answers of either row that did not finish. On fully correct, each counts as not. */
  notOk: { sourceId: string; questionId: string; row: AnswerRow; status: AnswerStatus }[]
  /** Row b's hallucinations on the questions the docs do not answer, in its first answers. */
  hallucinations: { sourceId: string; questionId: string }[]
  /** Whether the verdict names b on fully correct, and names a on no other metric. */
  holds: boolean
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
  if (value.answers !== undefined && !hasAnswersOutline(value.answers)) {
    return { ok: false, error: 'a report with answers needs their models, prompts and results' }
  }
  return { ok: true, value: value as unknown as EvalReport }
}

function hasAnswersOutline(value: unknown): boolean {
  return (
    isRecord(value) &&
    isRecord(value.models) &&
    isRecord(value.prompts) &&
    [value.rows, value.comparisons, value.answers, value.verdicts, value.support].every((list) =>
      Array.isArray(list),
    )
  )
}

/** Why this is not labels against a judge, as both kinds of file record them, if it is not. */
function labelsOutlineError(value: Record<string, unknown>, what: string): string | undefined {
  const { report, agreement } = value
  if (!isRecord(report) || typeof report.createdAt !== 'string') {
    return `${what} needs report, with createdAt`
  }
  if (!Array.isArray(agreement)) return `${what} needs agreement`
  const whole = agreement.every(
    (result) =>
      isRecord(result) &&
      typeof result.dimension === 'string' &&
      typeof result.agreed === 'number' &&
      typeof result.compared === 'number' &&
      Array.isArray(result.interval),
  )
  return whole ? undefined : 'each agreement needs its dimension, counts and interval'
}

/** A calibration file, or why it is not one. It checks the outline, as a report's parse does. */
export function parseEvalCalibration(value: unknown): Parsed<EvalCalibration> {
  if (!isRecord(value)) return { ok: false, error: 'a calibration must be a JSON object' }
  const error = labelsOutlineError(value, 'a calibration')
  if (error !== undefined) return { ok: false, error }
  return { ok: true, value: value as unknown as EvalCalibration }
}

/** A spot check's file, or why it is not one. */
export function parseEvalSpotCheck(value: unknown): Parsed<EvalSpotCheck> {
  if (!isRecord(value)) return { ok: false, error: 'a spot check must be a JSON object' }
  const error = labelsOutlineError(value, 'a spot check')
  if (error !== undefined) return { ok: false, error }
  if (typeof value.passed !== 'boolean' || typeof value.allowed !== 'number') {
    return { ok: false, error: 'a spot check needs passed and allowed' }
  }
  if (!Array.isArray(value.supportDisagreements)) {
    return { ok: false, error: 'a spot check needs supportDisagreements' }
  }
  return { ok: true, value: value as unknown as EvalSpotCheck }
}

/** A source's `eval/about.json`, or why it is not one. */
export function parseEvalSourceAbout(value: unknown): Parsed<EvalSourceAbout> {
  if (!isRecord(value)) return { ok: false, error: 'an about file must be a JSON object' }
  const { set, staysOnHybrid } = value
  if (set !== undefined && typeof set !== 'string') {
    return { ok: false, error: 'set must be a string' }
  }
  if (staysOnHybrid !== undefined && typeof staysOnHybrid !== 'string') {
    return { ok: false, error: 'staysOnHybrid must be a string' }
  }
  return { ok: true, value }
}

const VERIFY_STATUSES: readonly string[] = [
  'identical',
  'equivalent',
  'inconclusive',
  'different',
  'not-comparable',
] satisfies EvalVerifyRecord['status'][]

/** A verify record, or why it is not one. */
export function parseEvalVerifyRecord(value: unknown): Parsed<EvalVerifyRecord> {
  if (!isRecord(value)) return { ok: false, error: 'a verify record must be a JSON object' }
  const { status, changedVectors, rerun } = value
  if (typeof status !== 'string' || !VERIFY_STATUSES.includes(status)) {
    return { ok: false, error: 'a verify record needs a status this code knows' }
  }
  if (!Array.isArray(changedVectors)) {
    return { ok: false, error: 'a verify record needs changedVectors' }
  }
  if (!isRecord(rerun) || typeof rerun.repoSha !== 'string' || typeof rerun.at !== 'string') {
    return { ok: false, error: 'a verify record needs rerun, with repoSha and at' }
  }
  return { ok: true, value: value as unknown as EvalVerifyRecord }
}
