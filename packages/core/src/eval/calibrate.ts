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
  EvalSpotCheck,
  EvalSupport,
  EvalVerdict,
  RefusalOutcome,
  SupportDisagreement,
} from '@docs-rag-lab/contracts'

import { seeded } from './bootstrap.ts'
import type { GoldenQuestion, GoldenTag } from './golden.ts'
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

/** The round of a milestone's new rows (ADR-0014), with a seed of its own. */
export const NEW_ROWS_SEED = LABEL_SEED + 2
const NEW_ROWS_ANSWERS = 15
const NEW_ROWS_UNANSWERABLE = 3

/** The spot check of a new source (ADR-0016), with a seed of its own. */
export const SPOT_CHECK_SEED = LABEL_SEED + 3
export const SPOT_CHECK_ANSWERS = 10
const SPOT_CHECK_UNANSWERABLE = 2
/** The last row gets the extra answer, so this is 3 from row 0, 3 from row 4 and 4 from row 3. */
export const SPOT_CHECK_ROWS: readonly AnswerRow[] = [0, 4, 3]

/** Which rows a spot check takes its 10 answers from, and what they have to cover. */
export interface SpotCheckPlan {
  /** The last row gets the extra answer. */
  rows: readonly AnswerRow[]
  unanswerable: number
  /** A tag the sample has to cover at least this often, before anything else. */
  required?: { tag: GoldenTag; count: number }
}

/** ADR-0016's, for a new source: 3 from row 0, 3 from row 4 and 4 from row 3, 2 unanswerable. */
export const SOURCE_SPOT_CHECK: SpotCheckPlan = {
  rows: SPOT_CHECK_ROWS,
  unanswerable: SPOT_CHECK_UNANSWERABLE,
}

/**
 * ADR-0017's, for the compiled index: 3 from row 0, 3 from row 3 and 4 from row 7, 1 unanswerable,
 * and at least 5 on the questions about error codes.
 */
export const COMPILED_SPOT_CHECK: SpotCheckPlan = {
  rows: [0, 3, 7],
  unanswerable: 1,
  required: { tag: 'error-code', count: 5 },
}

/** The plan for a report: the compiled index's when it has row 7, and a new source's otherwise. */
export function spotCheckPlanFor(rows: ReadonlySet<AnswerRow>): SpotCheckPlan {
  return rows.has(7) ? COMPILED_SPOT_CHECK : SOURCE_SPOT_CHECK
}
/** What ADR-0012's bar allows at 8 and at 12 compared. */
const SPOT_CHECK_ALLOWED = 1

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
  /** How many answers. The second round's 10 by default. */
  total?: number
  /** How many of them are on questions the docs do not answer. None by default. */
  unanswerable?: number
  /** A tag the round has to cover at least this often, taken in turn across the rows. */
  required?: { tag: GoldenTag; count: number } | undefined
}

/**
 * The second round (ADR-0012): 10 answers to questions the docs answer, none on a question of
 * the first round, none on the same question twice. Spread across the rows, with the last row
 * getting any extra, and at least 3 the judge scored low when there are 3.
 */
export function freshSampleForLabels(options: FreshSampleOptions): EvalAnswer[] {
  const { rows, answers, verdicts, questions, exclude } = options
  const seed = options.seed ?? FRESH_SEED
  const total = options.total ?? FRESH_ANSWERS
  const refusals = options.unanswerable ?? 0
  const random = seeded(seed)
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
            (refusals > 0 || answerable.has(answer.questionId)) &&
            !used.has(answer.questionId),
        )
        .sort((a, b) => a.questionId.localeCompare(b.questionId)),
      random,
    ),
  )
  const extra = total % rows.length
  const quota = rows.map(
    (_, i) => Math.floor(total / rows.length) + (i >= rows.length - extra ? 1 : 0),
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
  const isAnswerable = (answer: EvalAnswer): boolean => answerable.has(answer.questionId)
  for (let round = 0, taken = 0; round < total && taken < refusals; round++) {
    const i = round % rows.length
    if (take(i, (answer) => !isAnswerable(answer))) taken++
  }
  // A tag the round has to cover comes next, in turn across the rows (ADR-0017). Without one, the
  // sample is what it always was, so earlier labels still match theirs.
  const { required } = options
  if (required !== undefined) {
    const tagged = new Set(
      questions.filter(({ tags }) => tags.includes(required.tag)).map(({ id }) => id),
    )
    for (let round = 0, got = 0; round < total && got < required.count; round++) {
      const i = round % rows.length
      if (take(i, (answer) => tagged.has(answer.questionId))) got++
    }
  }
  // One low score per row in turn, up to the minimum, then whatever else fills each row.
  for (let round = 0, lows = 0; round < total && lows < MIN_LOW; round++) {
    for (let i = 0; i < rows.length && lows < MIN_LOW; i++) {
      if (take(i, isLow)) lows++
    }
  }
  rows.forEach((_, i) => {
    while (take(i, isAnswerable));
  })
  const sample = picked.flat()
  return shuffled(sample, seeded(seed ^ parseInt(sampleHash(sample).slice(0, 8), 16)))
}

/**
 * The round for rows new in a milestone (ADR-0014): 15 answers with all three dimensions to label,
 * 3 of them on questions the docs do not answer, none on the same question twice.
 */
export function newRowsSampleForLabels(options: SampleOptions): EvalAnswer[] {
  return freshSampleForLabels({
    ...options,
    exclude: [],
    total: NEW_ROWS_ANSWERS,
    unanswerable: NEW_ROWS_UNANSWERABLE,
    seed: options.seed ?? NEW_ROWS_SEED,
  })
}

/**
 * A spot check (ADR-0016, ADR-0017): 10 answers with all three dimensions to label, from the plan's
 * rows, none on the same question twice. A new source's plan by default.
 */
export function spotCheckSampleForLabels(
  options: Omit<SampleOptions, 'rows'>,
  plan: SpotCheckPlan = SOURCE_SPOT_CHECK,
): EvalAnswer[] {
  return freshSampleForLabels({
    ...options,
    rows: plan.rows,
    exclude: [],
    total: SPOT_CHECK_ANSWERS,
    unanswerable: plan.unanswerable,
    required: plan.required,
    seed: options.seed ?? SPOT_CHECK_SEED,
  })
}

/** A fresh spot check, after a change left the first one's labels no longer blind (ADR-0017). */
export const FRESH_SPOT_CHECK_SEED = LABEL_SEED + 4

/** Which answers a fresh spot check takes. */
export interface FreshSpotCheckPlan {
  rows: readonly AnswerRow[]
  /** Answers from each row. */
  perRow: number
  /** Only questions with this tag. */
  tag: GoldenTag
}

/** ADR-0017's, after version 3 of the set: 5 from row 3 and 5 from row 7, on the error codes. */
export const COMPILED_FRESH_SPOT_CHECK: FreshSpotCheckPlan = {
  rows: [3, 7],
  perRow: 5,
  tag: 'error-code',
}

export interface FreshSpotCheckOptions {
  answers: readonly EvalAnswer[]
  questions: readonly GoldenQuestion[]
  /** What the first spot check showed. No answer with its question and row is shown again. */
  exclude: readonly Pick<EvalAnswer, 'questionId' | 'row'>[]
  seed?: number
}

const answerKey = (answer: Pick<EvalAnswer, 'questionId' | 'row'>): string =>
  `${answer.questionId}/${String(answer.row)}`

/**
 * A fresh spot check (ADR-0017): first answers on the plan's tag, as many from each row, none the
 * first spot check showed, so a question can come once from each row. It reads no verdict, so it is
 * fixed before the judge grades again. A row with too few answers left gives what it has.
 */
export function freshSpotCheckSampleForLabels(
  options: FreshSpotCheckOptions,
  plan: FreshSpotCheckPlan = COMPILED_FRESH_SPOT_CHECK,
): EvalAnswer[] {
  const seed = options.seed ?? FRESH_SPOT_CHECK_SEED
  const random = seeded(seed)
  const tagged = new Set(
    options.questions.filter(({ tags }) => tags.includes(plan.tag)).map(({ id }) => id),
  )
  const shown = new Set(options.exclude.map(answerKey))
  const sample = plan.rows.flatMap((row) =>
    shuffled(
      options.answers
        .filter(
          (answer) =>
            answer.row === row &&
            answer.sample === 1 &&
            answer.status === 'ok' &&
            tagged.has(answer.questionId) &&
            !shown.has(answerKey(answer)),
        )
        .sort((a, b) => a.questionId.localeCompare(b.questionId)),
      random,
    ).slice(0, plan.perRow),
  )
  return shuffled(sample, seeded(seed ^ parseInt(sampleHash(sample).slice(0, 8), 16)))
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

export interface SpotCheckOptions extends CalibrateOptions {
  prompts: Record<string, string>
  judgeModel: string
}

/**
 * How often the human and the judge agree on a spot check. It counts the same way as a round, and
 * only the bar differs: at most one disagreement on each dimension it could compare.
 */
export function spotCheck(options: SpotCheckOptions): EvalSpotCheck {
  const { report, correctnessDisagreements, labelled, agreement, unanswerableOnly } =
    calibrate(options)
  const supportDisagreements = options.labels.flatMap((label): SupportDisagreement[] => {
    const claims = options.support.find(
      (item) =>
        item.questionId === label.questionId &&
        item.row === label.row &&
        item.sample === 1 &&
        item.status === 'ok',
    )?.claims
    if (label.supported === null || claims === undefined || claims.length === 0) return []
    const judge = claims.every((claim) => claim.supported)
    return judge === label.supported
      ? []
      : [{ questionId: label.questionId, row: label.row, human: label.supported, judge }]
  })
  const compared = agreement
    .filter((result) => result.compared > 0)
    .map((result) => ({
      ...result,
      passed: result.compared - result.agreed <= SPOT_CHECK_ALLOWED,
    }))
  return {
    report,
    prompts: options.prompts,
    judgeModel: options.judgeModel,
    correctnessDisagreements: correctnessDisagreements ?? [],
    supportDisagreements,
    labelled,
    agreement: compared,
    unanswerableOnly,
    allowed: SPOT_CHECK_ALLOWED,
    passed: compared.length > 0 && compared.every((result) => result.passed),
  }
}
