// What the eval dashboard shows (SPEC section 3, ADR-0013): plain data that core builds from
// the committed reports and ui renders, with every number's uncertainty beside it.
import type { DifferenceVerdict } from './eval-difference.ts'

/**
 * One number and its uncertainty. A share has a 95% Wilson interval, a mean a 95% percentile
 * bootstrap over questions. `none` says why there is no number, and `text` is for what has
 * units of its own, with its interval already in the words.
 */
export type EvalFigure =
  | { kind: 'share'; count: number; of: number; low: number; high: number }
  | { kind: 'mean'; value: number; of: number; low: number; high: number }
  | { kind: 'none'; reason: string }
  | { kind: 'text'; text: string }

/** Two sides compared question by question (ADR-0010). */
export interface EvalSplit {
  a: string
  b: string
  /** The questions on which each side is ahead. */
  aAhead: number
  bAhead: number
  tied: number
  p: number
  verdict: DifferenceVerdict
}

export interface DashboardRow {
  id: string
  label: string
  /** Stands next to the label, such as "may run high". */
  note?: string
  /** Defined after seeing results, and no target (ADR-0012). */
  exploratory: boolean
  /** One per column of the section, in order. */
  figures: EvalFigure[]
  comparisons: EvalSplit[]
  /** Questions that differ between two runs of hybrid; null when there was no second run. */
  runToRun: number | null
}

export interface DashboardSection {
  question: string
  /** One plain sentence. It never rests on an exploratory metric. */
  summary: string
  columns: string[]
  rows: DashboardRow[]
  /** Whether the section has a run-to-run column. Retrieval repeats exactly. */
  showRunToRun: boolean
}

export type CalibrationDimension = 'correctness' | 'refusal' | 'support'

export interface DashboardAgreement {
  dimension: CalibrationDimension
  agreed: number
  compared: number
  kappa: number | null
  low: number
  high: number
  passed: boolean
}

export interface DashboardRound {
  /** A plain name for the round, such as "Fresh round". */
  name: string
  /** False when the prompt changed after the labels were read. It then decides nothing. */
  blind: boolean
  agreement: DashboardAgreement[]
}

export interface DashboardJudge {
  /** Every dimension has a blind round under this report's prompts, and passed it. */
  calibrated: boolean
  /** What decides, per dimension, for this report's prompts. Missing means not calibrated. */
  agreement: DashboardAgreement[]
  /** Every disagreement on correctness, over all blind rounds. */
  judgeHigher: number
  judgeLower: number
  /** The sentence to show, or null when there is nothing to say. */
  bias: string | null
  /** The note beside every correctness number, or null. */
  note: string | null
  rounds: DashboardRound[]
}

export interface DashboardTrust {
  /** Null for a report with no answers. */
  judge: DashboardJudge | null
  goldenSet: { version: number; hash: string }
  docs: { repo: string; branch: string; sha: string }
  /** The commit the index is at now, or null when there is no index. */
  indexDocsSha: string | null
  stale: string[]
  review: string[]
  /** What the last recorded re-run found, or null when none was recorded. */
  verify: { status: string; text: string; checkedAt: string } | null
}

export interface DashboardRun {
  id: string
  name: string
  createdAt: string
  repoSha: string
  retrieval: DashboardSection
  /** Null for a report with no answers. */
  answers: DashboardSection | null
  trust: DashboardTrust
}

/** One line in the list of runs. */
export interface DashboardRunEntry {
  id: string
  name: string
  createdAt: string
  sha: string
  hasAnswers: boolean
}

export interface DashboardQuestion {
  id: string
  question: string
  tags: string[]
  /** In the section's order: the rank each strategy gives the right chunk, or null. */
  ranks: { column: string; rank: number | null }[]
  /** In the section's order: what each row's answer got, in words. */
  answers: { column: string; grade: string }[]
  /** Whether strategies or rows differ on this question. */
  differs: boolean
}

export interface DashboardCandidate {
  questionId: string
  column: string
  chunkId: string
  docPath: string
}

export interface DashboardDetails {
  /** One section per metric, with a row per tag. */
  tags: DashboardSection[]
  questions: DashboardQuestion[]
  candidates: DashboardCandidate[]
}

export interface DashboardMovedRank {
  strategy: string
  questionId: string
  from: number | null
  to: number | null
}

/** Two runs side by side, or why they cannot be. */
export type DashboardRunComparison =
  | { comparable: false; reason: string }
  | {
      comparable: true
      a: string
      b: string
      /** What else differs between the two, since a change of rank means little until this is known. */
      differences: string[]
      section: DashboardSection
      moved: DashboardMovedRank[]
    }
