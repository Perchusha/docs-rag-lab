// Can the judge be trusted? (SPEC section 10, ADR-0012.) A human labels about 15 answers
// without seeing the verdicts, and this says how often the two agree. The sample comes from
// a fixed seed, so it is the same every time, and picking it from the judge's own low scores
// is the only thing the judge has to do with it.
import type {
  AgreementResult,
  AnswerLabel,
  AnswerRow,
  EvalAnswer,
  EvalCalibration,
  EvalSupport,
  EvalVerdict,
} from '@docs-rag-lab/contracts'

import type { GoldenQuestion } from './golden.ts'
import { isUnanswerable } from './judge.ts'

/** The bar for trusting the judge: 13 of 15 on each dimension. */
const AGREEMENT_BAR = 13 / 15

/** Answers per row. With 3 rows this makes 15. */
const PER_ROW = 5

export const LABEL_SEED = 20_261_103

/** A small seeded generator (mulberry32): the sample needs to repeat, not to be secure. */
function seeded(seed: number): () => number {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    const [x, y] = [result[i], result[j]]
    if (x !== undefined && y !== undefined) {
      result[i] = y
      result[j] = x
    }
  }
  return result
}

export interface SampleOptions {
  rows: readonly AnswerRow[]
  answers: readonly EvalAnswer[]
  verdicts: readonly EvalVerdict[]
  questions: readonly GoldenQuestion[]
  seed?: number
}

/**
 * 5 answers per row: one unanswerable question, one the judge scored low, and three others.
 * So at least 3 of 15 are unanswerable, and at least 3 scored low when a row has any. The
 * order is shuffled, so nothing says which row an answer came from.
 */
export function sampleForLabels(options: SampleOptions): EvalAnswer[] {
  const { rows, answers, verdicts, questions } = options
  const random = seeded(options.seed ?? LABEL_SEED)
  const questionOf = new Map(questions.map((question) => [question.id, question]))
  const score = new Map(
    verdicts
      .filter((verdict) => verdict.judgeSample === 1 && verdict.sample === 1)
      .map((verdict) => [`${verdict.questionId}/${String(verdict.row)}`, verdict.correctness]),
  )
  const picked: EvalAnswer[] = []
  for (const row of rows) {
    const eligible = shuffled(
      answers
        .filter((answer) => answer.row === row && answer.sample === 1 && answer.status === 'ok')
        .sort((a, b) => a.questionId.localeCompare(b.questionId)),
      random,
    )
    const unanswerable = (answer: EvalAnswer): boolean => {
      const question = questionOf.get(answer.questionId)
      return question !== undefined && isUnanswerable(question)
    }
    const low = (answer: EvalAnswer): boolean => {
      const value = score.get(`${answer.questionId}/${String(row)}`)
      return value === 0 || value === 1
    }
    const chosen = [
      ...eligible.filter(unanswerable).slice(0, 1),
      ...eligible.filter((answer) => !unanswerable(answer) && low(answer)).slice(0, 1),
    ]
    for (const answer of eligible) {
      if (chosen.length >= PER_ROW) break
      if (!unanswerable(answer) && !chosen.includes(answer)) chosen.push(answer)
    }
    picked.push(...chosen)
  }
  return shuffled(picked, random)
}

/** Cohen's kappa over paired labels. Undefined when chance alone predicts every agreement. */
export function cohensKappa<T>(pairs: readonly (readonly [T, T])[]): number | null {
  if (pairs.length === 0) return null
  const agreed = pairs.filter(([a, b]) => a === b).length / pairs.length
  const values = new Set(pairs.flat())
  let chance = 0
  for (const value of values) {
    const a = pairs.filter(([x]) => x === value).length / pairs.length
    const b = pairs.filter(([, y]) => y === value).length / pairs.length
    chance += a * b
  }
  return chance === 1 ? null : (agreed - chance) / (1 - chance)
}

/** The 95% Wilson interval on a share. It stays honest at 14 of 15, unlike the simple one. */
export function wilsonInterval(successes: number, total: number): [number, number] {
  if (total === 0) return [0, 1]
  const z = 1.959964
  const share = successes / total
  const denominator = 1 + (z * z) / total
  const centre = (share + (z * z) / (2 * total)) / denominator
  const margin =
    (z * Math.sqrt((share * (1 - share)) / total + (z * z) / (4 * total * total))) / denominator
  return [Math.max(0, centre - margin), Math.min(1, centre + margin)]
}

function agreement<T>(
  dimension: AgreementResult['dimension'],
  pairs: readonly (readonly [T, T])[],
): AgreementResult {
  const agreed = pairs.filter(([a, b]) => a === b).length
  return {
    dimension,
    compared: pairs.length,
    agreed,
    kappa: cohensKappa(pairs),
    interval: wilsonInterval(agreed, pairs.length),
    passed: pairs.length > 0 && agreed / pairs.length >= AGREEMENT_BAR,
  }
}

export interface CalibrateOptions {
  report: EvalCalibration['report']
  labels: readonly AnswerLabel[]
  verdicts: readonly EvalVerdict[]
  support: readonly EvalSupport[]
}

/** How often the human and the judge agree, per dimension. */
export function calibrate(options: CalibrateOptions): EvalCalibration {
  const { labels, verdicts, support } = options
  const verdictOf = (label: AnswerLabel): EvalVerdict | undefined =>
    verdicts.find(
      (verdict) =>
        verdict.questionId === label.questionId &&
        verdict.row === label.row &&
        verdict.sample === 1 &&
        verdict.judgeSample === 1 &&
        verdict.status === 'ok',
    )
  const supportOf = (label: AnswerLabel): EvalSupport | undefined =>
    support.find(
      (item) =>
        item.questionId === label.questionId &&
        item.row === label.row &&
        item.sample === 1 &&
        item.status === 'ok',
    )
  const correctness = labels.flatMap((label) => {
    const judged = verdictOf(label)?.correctness
    return label.correctness === null || judged == null
      ? []
      : [[label.correctness, judged] as const]
  })
  const outcome = labels.flatMap((label) => {
    const judged = verdictOf(label)?.outcome
    return label.outcome === null || judged == null ? [] : [[label.outcome, judged] as const]
  })
  const supported = labels.flatMap((label) => {
    const claims = supportOf(label)?.claims
    return label.supported === null || claims === undefined || claims.length === 0
      ? []
      : [[label.supported, claims.every((claim) => claim.supported)] as const]
  })
  const results = [
    agreement('correctness', correctness),
    agreement('outcome', outcome),
    agreement('support', supported),
  ]
  return {
    report: options.report,
    labelled: labels.length,
    agreement: results,
    calibrated: results.every((result) => result.passed),
  }
}
