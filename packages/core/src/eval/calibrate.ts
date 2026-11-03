// Can the judge be trusted? (SPEC section 10, ADR-0012.) A human labels about 15 answers
// without seeing the verdicts, and this says how often the two agree. The sample comes from
// a fixed seed, so it is the same every time, and picking it from the judge's own low scores
// is the only thing the judge has to do with it.
import { createHash } from 'node:crypto'

import type {
  AgreementResult,
  AnswerLabel,
  AnswerRow,
  CalibrationDisagreement,
  EvalAnswer,
  EvalCalibration,
  EvalSupport,
  EvalVerdict,
  RefusalOutcome,
} from '@docs-rag-lab/contracts'

import { seeded } from './bootstrap.ts'
import type { GoldenQuestion } from './golden.ts'
import { isUnanswerable } from './judge.ts'

/** The bar for trusting the judge: 13 of 15 on each dimension. */
const AGREEMENT_BAR = 13 / 15

/** Answers per row. With 3 rows this makes 15. */
const PER_ROW = 5

/** At least this many answers the judge scored low, when there are that many. */
const MIN_LOW = 3

export const LABEL_SEED = 20_261_103

/** The second round's own seed, so that it does not repeat the first's choices. */
export const FRESH_SEED = LABEL_SEED + 1

/** Answers in the second round. */
const FRESH_ANSWERS = 10

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
 * 5 answers per row: one unanswerable question, some the judge scored low, and others. So
 * at least 3 of 15 are unanswerable, and at least 3 scored low when there are 3. The order
 * is shuffled, so nothing says which row an answer came from.
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
  const isRefusal = (answer: EvalAnswer): boolean => {
    const question = questionOf.get(answer.questionId)
    return question !== undefined && isUnanswerable(question)
  }
  const candidates: { eligible: EvalAnswer[]; refusal: EvalAnswer[]; low: EvalAnswer[] }[] = []
  for (const row of rows) {
    const eligible = shuffled(
      answers
        .filter((answer) => answer.row === row && answer.sample === 1 && answer.status === 'ok')
        .sort((a, b) => a.questionId.localeCompare(b.questionId)),
      random,
    )
    const unanswerable = isRefusal
    const low = (answer: EvalAnswer): boolean => {
      const value = score.get(`${answer.questionId}/${String(row)}`)
      return value === 0 || value === 1
    }
    candidates.push({
      eligible,
      refusal: eligible.filter(unanswerable).slice(0, 1),
      low: eligible.filter((answer) => !unanswerable(answer) && low(answer)),
    })
  }
  // One low score from each row first, then more from rows that have them, up to 3 in all.
  const lows = candidates.map((): EvalAnswer[] => [])
  const most = Math.max(0, ...candidates.map(({ low }) => low.length))
  for (let round = 0; round < most; round++) {
    candidates.forEach((candidate, i) => {
      const next = candidate.low[round]
      if (next !== undefined && lows.flat().length < MIN_LOW) lows[i]?.push(next)
    })
  }
  const picked = candidates.flatMap((candidate, i) => {
    const chosen = [...candidate.refusal, ...(lows[i] ?? [])]
    for (const answer of candidate.eligible) {
      if (chosen.length >= PER_ROW) break
      if (!isRefusal(answer) && !chosen.includes(answer)) chosen.push(answer)
    }
    return chosen
  })
  // Seeded by what was picked, so that a position says nothing across reports either.
  return shuffled(picked, seeded(LABEL_SEED ^ parseInt(sampleHash(picked).slice(0, 8), 16)))
}

export interface FreshSampleOptions extends SampleOptions {
  /** The answers of the earlier round. Their questions are left out altogether. */
  exclude: readonly Pick<EvalAnswer, 'questionId'>[]
}

/**
 * The second round (ADR-0012): 10 answers to questions the docs answer, none on a question of
 * the first round, none on the same question twice. Spread across the rows, with the last row
 * getting any extra, and at least 3 the judge scored low when there are 3.
 */
export function freshSampleForLabels(options: FreshSampleOptions): EvalAnswer[] {
  const { rows, answers, verdicts, questions, exclude } = options
  const random = seeded(options.seed ?? FRESH_SEED)
  const answerable = new Set(
    questions.filter((question) => !isUnanswerable(question)).map(({ id }) => id),
  )
  const used = new Set(exclude.map(({ questionId }) => questionId))
  const low = new Set(
    verdicts
      .filter(
        (verdict) =>
          verdict.judgeSample === 1 &&
          verdict.sample === 1 &&
          (verdict.correctness === 0 || verdict.correctness === 1),
      )
      .map((verdict) => `${verdict.questionId}/${String(verdict.row)}`),
  )
  const isLow = (answer: EvalAnswer): boolean =>
    low.has(`${answer.questionId}/${String(answer.row)}`)
  const pools = rows.map((row) =>
    shuffled(
      answers
        .filter(
          (answer) =>
            answer.row === row &&
            answer.sample === 1 &&
            answer.status === 'ok' &&
            answerable.has(answer.questionId) &&
            !used.has(answer.questionId),
        )
        .sort((a, b) => a.questionId.localeCompare(b.questionId)),
      random,
    ),
  )
  const extra = FRESH_ANSWERS % rows.length
  const quota = rows.map(
    (_, i) => Math.floor(FRESH_ANSWERS / rows.length) + (i >= rows.length - extra ? 1 : 0),
  )
  const picked = rows.map((): EvalAnswer[] => [])
  const taken = new Set<string>()
  const take = (i: number, wanted: (answer: EvalAnswer) => boolean): boolean => {
    const row = picked[i]
    const limit = quota[i] ?? 0
    if (row === undefined || row.length >= limit) return false
    const next = pools[i]?.find((answer) => wanted(answer) && !taken.has(answer.questionId))
    if (next === undefined) return false
    row.push(next)
    taken.add(next.questionId)
    return true
  }
  // One low score per row in turn, up to the minimum, then whatever else fills each row.
  for (let round = 0, lows = 0; round < FRESH_ANSWERS && lows < MIN_LOW; round++) {
    for (let i = 0; i < rows.length && lows < MIN_LOW; i++) {
      if (take(i, isLow)) lows++
    }
  }
  rows.forEach((_, i) => {
    while (take(i, () => true));
  })
  const sample = picked.flat()
  return shuffled(sample, seeded(FRESH_SEED ^ parseInt(sampleHash(sample).slice(0, 8), 16)))
}

/** Names a sample, so that labels cannot be read against a different one. */
export function sampleHash(sample: readonly Pick<EvalAnswer, 'questionId' | 'row'>[]): string {
  return createHash('sha256')
    .update(
      sample
        .map((answer) => `${answer.questionId}/${String(answer.row)}`)
        .sort()
        .join(),
    )
    .digest('hex')
    .slice(0, 12)
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

/**
 * Whether an answer refused, and whether that was right, in one value: the same question
 * for every answer, so the bar means the same as on the other dimensions (the owner's rule).
 * Hallucination and wrong differ, but neither is a refusal: the line for unanswerable
 * questions alone keeps them apart.
 */
type RefusalClass = 'answered' | 'false-refusal' | 'correct-refusal' | 'no-refusal'

function refusalClass(
  outcome: RefusalOutcome | null | undefined,
  refused: boolean | null | undefined,
): RefusalClass | undefined {
  if (outcome != null) return outcome === 'correct-refusal' ? 'correct-refusal' : 'no-refusal'
  if (refused == null) return undefined
  return refused ? 'false-refusal' : 'answered'
}

export interface CalibrateOptions {
  report: EvalCalibration['report']
  labels: readonly AnswerLabel[]
  verdicts: readonly EvalVerdict[]
  support: readonly EvalSupport[]
  /** The dimensions to compare. The fresh round compares correctness alone. */
  dimensions?: readonly AgreementResult['dimension'][]
  /** False when the judge's prompt changed after these labels were read. */
  blind?: boolean
  /** The prompts these verdicts were graded under. */
  prompts?: Record<string, string>
  /** The model that graded them. */
  judgeModel?: string
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
  const correctnessDisagreements = labels.flatMap((label): CalibrationDisagreement[] => {
    const judged = verdictOf(label)?.correctness
    return label.correctness === null || judged == null || judged === label.correctness
      ? []
      : [{ questionId: label.questionId, row: label.row, human: label.correctness, judge: judged }]
  })
  const refusal = labels.flatMap((label) => {
    const verdict = verdictOf(label)
    const human = refusalClass(label.outcome, label.refused)
    const judged = refusalClass(verdict?.outcome, verdict?.falseRefusal)
    return human === undefined || judged === undefined ? [] : [[human, judged] as const]
  })
  const outcomes = labels.flatMap((label) => {
    const judged = verdictOf(label)?.outcome
    return label.outcome === null || judged == null ? [] : [[label.outcome, judged] as const]
  })
  const supported = labels.flatMap((label) => {
    const claims = supportOf(label)?.claims
    return label.supported === null || claims === undefined || claims.length === 0
      ? []
      : [[label.supported, claims.every((claim) => claim.supported)] as const]
  })
  const wanted = options.dimensions ?? ['correctness', 'refusal', 'support']
  const results = [
    agreement('correctness', correctness),
    agreement('refusal', refusal),
    agreement('support', supported),
  ].filter(({ dimension }) => wanted.includes(dimension))
  const blind = options.blind ?? true
  return {
    report: options.report,
    blind,
    ...(options.prompts === undefined ? {} : { prompts: options.prompts }),
    ...(options.judgeModel === undefined ? {} : { judgeModel: options.judgeModel }),
    correctnessDisagreements,
    labelled: labels.length,
    agreement: results,
    unanswerableOnly: {
      compared: outcomes.length,
      agreed: outcomes.filter(([human, judged]) => human === judged).length,
    },
    // Labels the judge's prompt was changed after cannot vouch for it, whatever they say.
    calibrated: blind && results.every((result) => result.passed),
  }
}
