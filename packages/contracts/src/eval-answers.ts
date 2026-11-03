// Answer metrics: what a report holds when a run also answered and judged (SPEC section
// 10, ADR-0012). An optional section of the report, so older reports stay readable.
import type { DifferenceVerdict } from './eval-difference.ts'

/** The rows of the strategy ladder (SPEC section 10) that answer metrics measure so far. */
export const ANSWER_ROWS = [0, 2, 3] as const

export type AnswerRow = (typeof ANSWER_ROWS)[number]

/**
 * ok: Claude finished. truncated: it hit max_tokens. refused: a safety classifier stopped
 * it, which is not the same as saying the docs do not cover something. failed: no answer,
 * from an API error or another model answering. Only ok counts in the metrics: an API
 * error is never a score of 0.
 */
export type AnswerStatus = 'ok' | 'truncated' | 'refused' | 'failed'

/** One passage an answer cites. */
export interface EvalCitation {
  chunkId: string
  citedText: string
}

/** A text block of an answer that cites something, with all it cites. */
export interface EvalClaim {
  text: string
  citations: EvalCitation[]
}

export interface EvalAnswer {
  questionId: string
  row: AnswerRow
  /** 1, or 2 for the second answer to the same request in a noise run. */
  sample: number
  status: AnswerStatus
  error?: string
  /** The model that answered, from the response. */
  model: string
  stopReason: string | null
  text: string
  /** The text blocks as Claude returned them, with every citation. */
  blocks: unknown[]
  /** Text blocks with citations. A claim's citations are all of them, not the first per source. */
  claims: EvalClaim[]
  /** The chunks the answer was given, in order. Empty for row 0. */
  context: string[]
  inputTokens: number
  outputTokens: number
  costUsd: number
  latencyMs: number
  firstTokenMs: number | null
  /** The request was answered before, so this run did not pay for it. */
  fromCache: boolean
}

/** How an answer to an unanswerable question handled it (the owner's rule, ADR-0009). */
export type RefusalOutcome = 'correct-refusal' | 'hallucination' | 'wrong'

export type VerdictStatus = 'ok' | 'failed'

export interface EvalVerdict {
  questionId: string
  row: AnswerRow
  sample: number
  /** 1, or 2 for the second opinion in a noise run. */
  judgeSample: number
  status: VerdictStatus
  error?: string
  reasoning: string
  /** 0 to 2, for a question the docs answer. */
  correctness: 0 | 1 | 2 | null
  /** A question the docs answer, and the answer says they do not. */
  falseRefusal: boolean | null
  /** For a question the docs do not answer. */
  outcome: RefusalOutcome | null
  costUsd: number
}

/** The judge's opinion of one answer's citations, in the order of its claims. */
export interface EvalSupport {
  questionId: string
  row: AnswerRow
  sample: number
  status: VerdictStatus
  error?: string
  claims: { supported: boolean; reason: string }[]
  costUsd: number
}

export interface AnswerMetrics {
  /** Questions with a verdict. */
  questions: number
  /** The mean score, 0 to 2. */
  correctness: number
  /** How many scored 0, 1 and 2. */
  scores: [number, number, number]
  falseRefusals: number
  /** Answers that cite something, and those among them that cite an anchor. */
  citationAccuracy: { cited: number; hit: number }
  /** Claims the judge read, and those it found supported. */
  support: { claims: number; supported: number }
  /**
   * Exploratory (ADR-0012): answers that score 2, have every cited claim supported, and cite an
   * anchor. Row 0 cannot score on it by design. Reports from before it was defined have none.
   */
  correctAndGrounded?: number
  meanLatencyMs: number
  meanInputTokens: number
  meanOutputTokens: number
  meanCostUsd: number
}

export interface RefusalMetrics {
  questions: number
  correct: number
  hallucinations: number
  wrong: number
}

export interface AnswerRowResult {
  row: AnswerRow
  sample: number
  overall: AnswerMetrics
  byTag: Record<string, AnswerMetrics>
  /** The questions the docs do not answer, reported apart. */
  refusals: RefusalMetrics
  /** Question IDs left out of the metrics, by why. unjudged: the judge's reply was unusable. */
  excluded: { truncated: string[]; refused: string[]; failed: string[]; unjudged: string[] }
}

export const ANSWER_COMPARED_METRICS = [
  'correctness',
  'citation-accuracy',
  'support',
  'correct-and-grounded',
] as const

export type AnswerComparedMetric = (typeof ANSWER_COMPARED_METRICS)[number]

export interface AnswerDifference {
  metric: AnswerComparedMetric
  /** The mean over the questions compared. */
  a: number
  b: number
  aBetter: number
  bBetter: number
  tied: number
  p: number
  verdict: DifferenceVerdict
}

export interface AnswerScopeComparison {
  scope: string
  questions: number
  differences: AnswerDifference[]
}

export interface AnswerComparison {
  a: string
  b: string
  scopes: AnswerScopeComparison[]
}

/** A cited chunk that supports a correct answer but is not an anchor. Never added by itself. */
export interface AnchorCandidate {
  questionId: string
  row: AnswerRow
  chunkId: string
  docPath: string
}

export interface EvalAnswers {
  models: { answer: string; judge: string }
  /** Hashes of the prompts, so two runs can tell whether they asked the same thing. */
  prompts: Record<string, string>
  rows: AnswerRowResult[]
  comparisons: AnswerComparison[]
  /** How often a second opinion from the judge matches its first, in a noise run. */
  judgeRetest: { compared: number; agreed: number } | null
  candidates: AnchorCandidate[]
  /** What this run itself paid. Cached answers and verdicts cost nothing again. */
  paidUsd: number
  answers: EvalAnswer[]
  verdicts: EvalVerdict[]
  support: EvalSupport[]
}

/** What the human labeller says about one answer. */
export interface AnswerLabel {
  questionId: string
  row: AnswerRow
  correctness: 0 | 1 | 2 | null
  /** On a question the docs answer, whether the answer refuses it. Null on any other. */
  refused: boolean | null
  outcome: RefusalOutcome | null
  /** Whether every cited claim is supported; null when the answer cites nothing. */
  supported: boolean | null
}

export interface AgreementResult {
  dimension: 'correctness' | 'refusal' | 'support'
  compared: number
  agreed: number
  /** Cohen's kappa, or null when one side used a single value and it is undefined. */
  kappa: number | null
  /** 95% Wilson interval on the share agreed. */
  interval: [number, number]
  /** Whether the share reaches 13 of 15, the bar agreed for trusting the judge. */
  passed: boolean
}

/** Where the human and the judge differ on correctness, for the known bias (ADR-0013). */
export interface CalibrationDisagreement {
  questionId: string
  row: AnswerRow
  human: 0 | 1 | 2
  judge: 0 | 1 | 2
}

/** What `drl eval verify --record` found (ADR-0013). */
export interface EvalVerifyRecord {
  status: 'identical' | 'equivalent' | 'inconclusive' | 'different' | 'not-comparable'
  changedVectors: string[]
  rerun: { repoSha: string; repoDirty: boolean; at: string }
}

export interface EvalCalibration {
  /** The report these labels are of. */
  report: { repoSha: string; name: string | null; createdAt: string }
  /** False when the judge's prompt changed after the labels were read. It then decides nothing. */
  blind?: boolean
  /** The prompts graded under, so that a change of prompt shows as not calibrated. */
  prompts?: Record<string, string>
  /** The model that graded, so that another judge shows as not calibrated too. */
  judgeModel?: string
  correctnessDisagreements?: CalibrationDisagreement[]
  labelled: number
  agreement: AgreementResult[]
  /** The three outcomes on unanswerable questions alone. Too little data to decide anything. */
  unanswerableOnly: { compared: number; agreed: number }
  /** Every dimension passed. If not, the answer metrics are uncalibrated. */
  calibrated: boolean
}
