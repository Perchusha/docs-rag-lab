// The dashboard's data, from a report (SPEC section 3, ADR-0013). Every number comes with its
// uncertainty, and a number and its verdict measure the same thing. Nothing here calls anything.
import type {
  AnswerComparedMetric,
  AnswerRow,
  ComparedMetric,
  DashboardCandidate,
  DashboardDetails,
  DashboardJudge,
  DashboardQuestion,
  DashboardRow,
  DashboardRun,
  DashboardRunComparison,
  DashboardSection,
  EvalAnswer,
  EvalAnswers,
  EvalCalibration,
  EvalFigure,
  EvalReport,
  EvalSourceAbout,
  EvalSpotCheck,
  EvalSplit,
  EvalStrategyResult,
  EvalVerdict,
  EvalVerifyRecord,
  HitCutoff,
  MetricDifference,
  Strategy,
} from '@docs-rag-lab/contracts'

import { bootstrapMean } from './bootstrap.ts'
import { wilsonInterval } from './calibrate.ts'
import { compareScores, signTest, verdictOf } from './compare.ts'
import type { GoldenQuestion } from './golden.ts'
import { reciprocal } from './metrics.ts'
import { judgeTrust, spotCheckView, verifyWords } from './trust.ts'
import { fieldDifferences } from './verify.ts'

const STRATEGY_NAMES: Record<Strategy, string> = {
  vector: 'Vector',
  hybrid: 'Hybrid',
  rerank: 'Rerank',
}
const ROW_NAMES: Record<AnswerRow, string> = {
  0: 'No RAG',
  2: 'Vector',
  3: 'Hybrid',
  4: 'Rerank',
  5: 'Rerank + contexts',
  7: 'Hybrid, compiled',
}
const ROWS: readonly AnswerRow[] = [0, 2, 3, 4, 5, 7]
const HYBRID = ROW_NAMES[3]
const RERANK = ROW_NAMES[4]
const WITH_CONTEXTS = ROW_NAMES[5]

/** Where room is short, a column that adds to another says only what it adds. */
const SHORT_NAMES: Readonly<Record<string, string>> = { [WITH_CONTEXTS]: '+ contexts' }

const shortOf = (name: string): Pick<EvalSplit, 'shortB'> => {
  const shortB = SHORT_NAMES[name]
  return shortB === undefined ? {} : { shortB }
}

/** A decision of the owner's, apart from any verdict (ADR-0014). */
const APP_STAYS_ON_HYBRID =
  'The app stays on hybrid, because the retrieval gain did not reach the answers (ADR-0014).'

const NO_DOCS: EvalFigure = { kind: 'none', reason: 'cannot: no docs' }
const NOTHING_TO_COUNT: EvalFigure = { kind: 'none', reason: 'none to count' }

export function shareFigure(count: number, of: number): EvalFigure {
  if (of === 0) return NOTHING_TO_COUNT
  const [low, high] = wilsonInterval(count, of)
  return { kind: 'share', count, of, low, high }
}

/** `max` is the top of the scale the values are on. */
export function meanFigure(values: readonly number[], max = 1): EvalFigure {
  if (values.length === 0) return NOTHING_TO_COUNT
  const { value, low, high } = bootstrapMean(values)
  return { kind: 'mean', value, of: values.length, low, high, max }
}

const fromDifference = (
  d: Pick<MetricDifference, 'aBetter' | 'bBetter' | 'tied' | 'p' | 'verdict'>,
  a: string,
  b: string,
): EvalSplit => ({
  a,
  b,
  aAhead: d.aBetter,
  bAhead: d.bBetter,
  tied: d.tied,
  p: d.p,
  verdict: d.verdict,
  ...shortOf(b),
})

type Values = ReadonlyMap<string, number>

/** Two sides question by question, over the questions both have. */
export function splitOf(a: string, valuesA: Values, b: string, valuesB: Values): EvalSplit {
  const pairs = [...valuesA].flatMap(([id, value]) => {
    const other = valuesB.get(id)
    return other === undefined ? [] : [[value, other] as const]
  })
  const aAhead = pairs.filter(([x, y]) => x > y).length
  const bAhead = pairs.filter(([x, y]) => y > x).length
  const p = signTest(aAhead, bAhead)
  const mean = (index: 0 | 1): number =>
    pairs.reduce((sum, pair) => sum + pair[index], 0) / Math.max(pairs.length, 1)
  return {
    a,
    b,
    aAhead,
    bAhead,
    tied: pairs.length - aAhead - bAhead,
    p,
    verdict: verdictOf({
      questions: pairs.length,
      aBetter: aAhead,
      bBetter: bAhead,
      p,
      a: mean(0),
      b: mean(1),
    }),
    ...shortOf(b),
  }
}

/**
 * A difference a row also shows against itself means nothing (ADR-0012, section 8). Each side of
 * a comparison can move by what a second run moved, so a margin up to twice that is noise.
 */
export function againstItself(split: EvalSplit, runToRun: number | null): EvalSplit {
  const named = split.verdict === 'a' || split.verdict === 'b'
  return named && runToRun !== null && Math.abs(split.aAhead - split.bAhead) <= 2 * runToRun
    ? { ...split, verdict: 'noise' }
    : split
}

/** How many questions differ between two samples. One that only one sample has is not a match. */
function differing(a: Values, b: Values): number {
  const ids = new Set([...a.keys(), ...b.keys()])
  return [...ids].filter((id) => a.get(id) !== b.get(id)).length
}

const strategyOf = (report: EvalReport, strategy: Strategy): EvalStrategyResult | undefined =>
  report.result.strategies.find((result) => result.strategy === strategy)

const hitFigure = (metrics: EvalStrategyResult['overall'], k: HitCutoff): EvalFigure =>
  shareFigure(metrics.primary.hits[k], metrics.questions)

function mrrValues(result: EvalStrategyResult, tag?: string): number[] {
  return result.questions
    .filter((question) => tag === undefined || question.tags.includes(tag))
    .map((question) => reciprocal(question.primaryRank))
}

const namedSide = ({ verdict, a, b }: EvalSplit): string | undefined =>
  verdict === 'a' ? a : verdict === 'b' ? b : undefined

/** Rows whose label does not read well after "better on". */
const IN_SENTENCE: Record<string, string> = {
  'top-1': 'the right chunk first',
  'citations-hold': 'citations that hold',
  'false-refusals': 'wrong refusals',
  'right-refusals': 'right refusals',
}

const inSentence = ({ id, label }: DashboardRow): string =>
  IN_SENTENCE[id] ?? label.charAt(0).toLowerCase() + label.slice(1)

/**
 * What the verdicts between two sides say, in sentences, or `nothing` when none names a side.
 * Only a verdict can make a claim, and an exploratory row makes none (ADR-0013).
 */
function verdictsBetween(
  rows: readonly DashboardRow[],
  sides: readonly [string, string],
  nothing: string,
): string {
  const found = rows
    .filter(({ exploratory }) => !exploratory)
    .flatMap((row) =>
      row.comparisons
        .filter(({ a, b }) => a === sides[0] && b === sides[1])
        .map((split) => ({ label: inSentence(row), split })),
    )
  if (found.length === 0) return ''
  if (found.every(({ split }) => split.verdict === 'too-few')) return 'Too few questions to say.'
  const labelsWhere = (test: (split: EvalSplit) => boolean): string =>
    found
      .filter(({ split }) => test(split))
      .map(({ label }) => label)
      .join(' and ')
  const claims = [
    ...sides.flatMap((side) => {
      const labels = labelsWhere((split) => namedSide(split) === side)
      return labels === '' ? [] : [`${side} better on ${labels}.`]
    }),
    ...[labelsWhere(({ verdict }) => verdict === 'mixed')].flatMap((labels) =>
      labels === '' ? [] : [`Mixed on ${labels}.`],
    ),
  ]
  return claims.length === 0 ? nothing : claims.join(' ')
}

function retrievalSection(report: EvalReport): DashboardSection {
  const results = report.result.strategies
  const columns = results.map(({ strategy }) => STRATEGY_NAMES[strategy])
  const overall = report.result.comparison?.scopes.find(({ scope }) => scope === 'overall')
  const compared = (metric: ComparedMetric): EvalSplit[] => {
    const found = overall?.primary.find((difference) => difference.metric === metric)
    return found === undefined ? [] : [fromDifference(found, 'Vector', 'Hybrid')]
  }
  const rows: DashboardRow[] = [
    {
      id: 'top-8',
      label: 'Right chunk in top 8',
      exploratory: false,
      figures: results.map(({ overall: metrics }) => hitFigure(metrics, 8)),
      comparisons: compared('hit@8'),
      runToRun: null,
    },
    {
      id: 'mrr',
      label: 'How high it ranks (MRR)',
      exploratory: false,
      figures: results.map((result) => meanFigure(mrrValues(result))),
      comparisons: compared('mrr'),
      runToRun: null,
    },
  ]
  const n = results[0]?.overall.questions ?? 0
  return {
    question: 'Does hybrid find the right chunks more often?',
    summary: verdictsBetween(
      rows,
      ['Vector', 'Hybrid'],
      `No difference holds up on these ${String(n)} questions.`,
    ),
    columns,
    scale: '0 to 1 (100%)',
    rows,
    showRunToRun: false,
  }
}

/** Reads one row's verdicts and answers, on questions the docs answer. */
class Grades {
  readonly #answers: EvalAnswers
  readonly #unanswerable: ReadonlySet<string>

  constructor(answers: EvalAnswers, unanswerable: readonly string[]) {
    this.#answers = answers
    this.#unanswerable = new Set(unanswerable)
  }

  verdicts(row: AnswerRow, sample: number, tag?: (id: string) => boolean): EvalVerdict[] {
    return this.#answers.verdicts.filter(
      (verdict) =>
        verdict.row === row &&
        verdict.sample === sample &&
        verdict.judgeSample === 1 &&
        verdict.status === 'ok' &&
        (tag === undefined || tag(verdict.questionId)),
    )
  }

  answered(row: AnswerRow, sample: number, tag?: (id: string) => boolean): EvalVerdict[] {
    return this.verdicts(row, sample, tag).filter(({ correctness }) => correctness !== null)
  }

  /** Each answerable question's value on something a verdict says. */
  valuesOf(
    row: AnswerRow,
    sample: number,
    pick: (verdict: EvalVerdict) => number,
    tag?: (id: string) => boolean,
  ): Map<string, number> {
    return new Map(
      this.answered(row, sample, tag).map((verdict) => [verdict.questionId, pick(verdict)]),
    )
  }

  /** Whether every claim an answer cites is supported, per answer (ADR-0013). */
  citationsHold(row: AnswerRow, sample: number): Map<string, number> {
    return new Map(
      this.#answers.support
        .filter(
          (item) =>
            item.row === row &&
            item.sample === sample &&
            item.status === 'ok' &&
            item.claims.length > 0 &&
            !this.#unanswerable.has(item.questionId),
        )
        .map((item) => [item.questionId, item.claims.every((claim) => claim.supported) ? 1 : 0]),
    )
  }

  refused(row: AnswerRow, sample: number): Map<string, number> {
    return new Map(
      this.verdicts(row, sample)
        .filter(({ outcome }) => outcome !== null)
        .map((verdict) => [verdict.questionId, verdict.outcome === 'correct-refusal' ? 1 : 0]),
    )
  }

  finished(row: AnswerRow): EvalAnswer[] {
    return this.#answers.answers.filter(
      (answer) =>
        answer.row === row &&
        answer.sample === 1 &&
        answer.status === 'ok' &&
        !this.#unanswerable.has(answer.questionId),
    )
  }
}

const sum = (values: Iterable<number>): number => {
  let total = 0
  for (const value of values) total += value
  return total
}

const rowsIn = (answers: EvalAnswers): AnswerRow[] =>
  ROWS.filter((row) => answers.rows.some((result) => result.row === row))

const hasSecondRun = (answers: EvalAnswers): boolean =>
  answers.rows.some(({ row, sample }) => row === 3 && sample === 2)

function storedDifference(
  answers: EvalAnswers,
  a: string,
  b: string,
  metric: AnswerComparedMetric,
) {
  return answers.comparisons
    .find((comparison) => comparison.a === a && comparison.b === b)
    ?.scopes.find(({ scope }) => scope === 'overall')
    ?.differences.find((difference) => difference.metric === metric)
}

/** What stands beside every correctness number: whether to trust it, and which way it leans. */
function correctnessNote(judge: DashboardJudge | null): string | null {
  if (judge === null) return null
  const notes = [...(judge.calibrated ? [] : ['not calibrated']), judge.note]
  return notes.filter((note) => note !== null).join(', ') || null
}

type RowPair = readonly [AnswerRow, AnswerRow]

/** Which rows a table of answers shows, and which of them it compares. */
interface AnswerView {
  rows: readonly AnswerRow[]
  /** Fully correct can compare more pairs than the other rows do. */
  fullyPairs: readonly RowPair[]
  pairs: readonly RowPair[]
  /** Whether each column keeps its own run to run, instead of one for hybrid alone. */
  perColumn: boolean
}

type MeasuredRow = Pick<DashboardRow, 'comparisons' | 'runToRun' | 'runToRuns'>

const RUN_TO_RUN_EACH = 'Run to run (each twice)'
const RUN_TO_RUN_ROWS = 'Run to run'

const answeredTwice = (answers: EvalAnswers, row: AnswerRow): boolean =>
  answers.rows.some((result) => result.row === row && result.sample === 2)

const hasRerankRows = (answers: EvalAnswers): boolean =>
  answers.rows.some(({ row }) => row === 4 || row === 5)

/**
 * A verdict that names a side clears the noise of its row (ADR-0013). With a run to run per
 * column, that is the larger of its two sides: either can move by what a second run moved.
 */
function clearNoise<T extends MeasuredRow>(row: T, columns: readonly string[]): T {
  const noiseOf = (split: EvalSplit): number | null => {
    const { runToRuns } = row
    if (runToRuns === undefined) return row.runToRun
    const counts = [split.a, split.b].flatMap((name) => {
      const count = runToRuns[columns.indexOf(name)]
      return count === undefined || count === null ? [] : [count]
    })
    return counts.length === 0 ? null : Math.max(...counts)
  }
  return {
    ...row,
    comparisons: row.comparisons.map((split) => againstItself(split, noiseOf(split))),
  }
}

function storedRow(
  answers: EvalAnswers,
  metric: AnswerComparedMetric,
  view: AnswerView,
): MeasuredRow {
  const label = (row: AnswerRow): string => `row ${String(row)}`
  const againOf = (row: AnswerRow): number | null => {
    const again = storedDifference(answers, label(row), `${label(row)} again`, metric)
    return again === undefined ? null : again.aBetter + again.bBetter
  }
  return {
    comparisons: view.pairs.flatMap(([a, b]) => {
      const between = storedDifference(answers, label(a), label(b), metric)
      return between === undefined ? [] : [fromDifference(between, ROW_NAMES[a], ROW_NAMES[b])]
    }),
    ...(view.perColumn
      ? { runToRun: null, runToRuns: view.rows.map(againOf) }
      : { runToRun: againOf(3) }),
  }
}

/** Every row a table of answers can have, for the rows of a view. */
function answerMeasures(
  report: EvalReport,
  answers: EvalAnswers,
  judge: DashboardJudge,
  view: AnswerView,
) {
  const grades = new Grades(answers, report.result.unanswerable)
  const { rows } = view
  const second = hasSecondRun(answers)
  const resultOf = (row: AnswerRow) =>
    answers.rows.find((result) => result.row === row && result.sample === 1)

  const compareRows = (values: (row: AnswerRow) => Values, pairs: readonly RowPair[]) =>
    pairs
      .filter(([a, b]) => rows.includes(a) && rows.includes(b))
      .map(([a, b]) => splitOf(ROW_NAMES[a], values(a), ROW_NAMES[b], values(b)))

  const fully = (row: AnswerRow, sample = 1): Values =>
    grades.valuesOf(row, sample, ({ correctness }) => (correctness === 2 ? 1 : 0))
  const refusedWithAnswer = (row: AnswerRow, sample = 1): Values =>
    grades.valuesOf(row, sample, ({ falseRefusal }) => (falseRefusal === true ? 1 : 0))
  // Fewer is better here, so the comparison counts the answers that did not refuse.
  const answeredWithAnswer = (row: AnswerRow): Values =>
    grades.valuesOf(row, 1, ({ falseRefusal }) => (falseRefusal === true ? 0 : 1))
  const shareOf = (values: Values): EvalFigure => shareFigure(sum(values.values()), values.size)
  const againOf = (
    values: (row: AnswerRow, sample: number) => Values,
  ): Pick<DashboardRow, 'runToRun' | 'runToRuns'> =>
    view.perColumn
      ? {
          runToRun: null,
          runToRuns: rows.map((row) =>
            answeredTwice(answers, row) ? differing(values(row, 1), values(row, 2)) : null,
          ),
        }
      : { runToRun: second ? differing(values(3, 1), values(3, 2)) : null }
  const note = correctnessNote(judge)
  const withNote = note === null ? {} : { note }

  const fullyCorrect: DashboardRow = {
    id: 'fully-correct',
    label: 'Fully correct',
    ...withNote,
    exploratory: false,
    figures: rows.map((row) => shareOf(fully(row))),
    comparisons: compareRows(fully, view.fullyPairs),
    ...againOf(fully),
  }
  const citationsHold: DashboardRow = {
    id: 'citations-hold',
    label: 'All citations hold',
    exploratory: false,
    figures: rows.map((row) => (row === 0 ? NO_DOCS : shareOf(grades.citationsHold(row, 1)))),
    comparisons: compareRows((row) => grades.citationsHold(row, 1), view.pairs),
    ...againOf((row, sample) => grades.citationsHold(row, sample)),
  }
  const grounded: DashboardRow = {
    id: 'correct-and-grounded',
    label: 'Correct and grounded',
    ...withNote,
    exploratory: true,
    figures: rows.map((row): EvalFigure => {
      const metrics = resultOf(row)?.overall
      if (row === 0) return { kind: 'none', reason: 'cannot, by design' }
      if (metrics?.correctAndGrounded === undefined) return { kind: 'none', reason: 'not computed' }
      return shareFigure(metrics.correctAndGrounded, metrics.questions)
    }),
    ...storedRow(answers, 'correct-and-grounded', view),
  }
  const anchors: DashboardRow = {
    id: 'cites-anchor',
    label: 'Cites the right passage',
    exploratory: false,
    figures: rows.map((row) => {
      const accuracy = resultOf(row)?.overall.citationAccuracy
      return row === 0 || accuracy === undefined
        ? NO_DOCS
        : shareFigure(accuracy.hit, accuracy.cited)
    }),
    ...storedRow(answers, 'citation-accuracy', view),
  }
  const falseRefusals: DashboardRow = {
    id: 'false-refusals',
    label: 'Wrongly refused',
    note: 'fewer is better',
    exploratory: false,
    figures: rows.map((row) => shareOf(refusedWithAnswer(row))),
    comparisons: compareRows(answeredWithAnswer, view.pairs),
    ...againOf(refusedWithAnswer),
  }
  const rightRefusals: DashboardRow = {
    id: 'right-refusals',
    label: 'Refused rightly',
    exploratory: false,
    figures: rows.map((row) => shareOf(grades.refused(row, 1))),
    comparisons: compareRows((row) => grades.refused(row, 1), view.pairs),
    ...againOf((row, sample) => grades.refused(row, sample)),
  }
  const cost: DashboardRow = {
    id: 'time-and-cost',
    label: 'Time and cost per answer',
    exploratory: false,
    figures: rows.map((row): EvalFigure => {
      const finished = grades.finished(row)
      if (finished.length === 0) return NOTHING_TO_COUNT
      const time = bootstrapMean(finished.map(({ latencyMs }) => latencyMs / 1000))
      const price = bootstrapMean(finished.map(({ costUsd }) => costUsd))
      return {
        kind: 'text',
        text: `${time.value.toFixed(1)} s (${time.low.toFixed(1)}-${time.high.toFixed(1)}), $${price.value.toFixed(3)} ($${price.low.toFixed(3)}-${price.high.toFixed(3)})`,
      }
    }),
    comparisons: [],
    runToRun: null,
  }
  // Grounding is claimed only when the answers show it: on most answers, past the interval, the
  // citations hold. An answer with no citation counts against it.
  const grounds = rows
    .filter((row) => row !== 0)
    .every((row) => {
      const [low] = wilsonInterval(sum(grades.citationsHold(row, 1).values()), fully(row).size)
      return low > 0.5
    })
  return {
    fully,
    grounds,
    fullyCorrect,
    citationsHold,
    grounded,
    anchors,
    falseRefusals,
    rightRefusals,
    cost,
  }
}

function answersSection(report: EvalReport, judge: DashboardJudge): DashboardSection | null {
  const { answers } = report
  if (answers === undefined) return null
  const view: AnswerView = {
    rows: rowsIn(answers),
    fullyPairs: [
      [2, 3],
      [0, 2],
      [0, 3],
    ],
    pairs: [[2, 3]],
    perColumn: false,
  }
  const measures = answerMeasures(report, answers, judge, view)
  const columns = view.rows.map((row) => ROW_NAMES[row])
  const sectionRows = [
    measures.fullyCorrect,
    measures.citationsHold,
    measures.grounded,
    measures.anchors,
    measures.falseRefusals,
    measures.rightRefusals,
    measures.cost,
  ].map((row) => clearNoise(row, columns))
  return {
    question: 'Does it give better answers, and does RAG help at all?',
    summary: [
      ...(judge.calibrated
        ? []
        : ['The judge is not calibrated for these prompts, so these are provisional.']),
      verdictsBetween(
        sectionRows,
        ['Vector', 'Hybrid'],
        'No difference between vector and hybrid holds up.',
      ),
      ragClaim(
        measures.fullyCorrect.comparisons,
        sectionRows[0]?.comparisons ?? [],
        measures.grounds,
      ),
    ]
      .filter((sentence) => sentence !== '')
      .join(' '),
    columns,
    scale: '0 to 100%',
    rows: sectionRows,
    showRunToRun: hasSecondRun(answers),
  }
}

function differenceBetween(
  a: EvalStrategyResult,
  b: EvalStrategyResult,
  scope: string,
  metric: ComparedMetric,
): MetricDifference | undefined {
  return compareScores({ name: 'a', questions: a.questions }, { name: 'b', questions: b.questions })
    .scopes.find((candidate) => candidate.scope === scope)
    ?.primary.find((difference) => difference.metric === metric)
}

interface RetrievalSide {
  name: string
  /** Undefined for a report of its own that could not be found. */
  result: EvalStrategyResult | undefined
}

const RETRIEVAL_MEASURES: readonly {
  id: string
  label: string
  metric: ComparedMetric
  figure: (result: EvalStrategyResult) => EvalFigure
}[] = [
  {
    id: 'top-1',
    label: 'Right chunk first',
    metric: 'hit@1',
    figure: ({ overall }) => hitFigure(overall, 1),
  },
  {
    id: 'top-8',
    label: 'Right chunk in top 8',
    metric: 'hit@8',
    figure: ({ overall }) => hitFigure(overall, 8),
  },
  {
    id: 'mrr',
    label: 'How high it ranks (MRR)',
    metric: 'mrr',
    figure: (result) => meanFigure(mrrValues(result)),
  },
]

/** One row per retrieval measure, comparing the given pairs of sides. */
function retrievalRows(
  sides: readonly RetrievalSide[],
  pairs: readonly (readonly [RetrievalSide, RetrievalSide])[],
): DashboardRow[] {
  return RETRIEVAL_MEASURES.map(({ id, label, metric, figure }) => ({
    id,
    label,
    exploratory: false,
    figures: sides.map(({ result }) =>
      result === undefined ? { kind: 'none', reason: 'in its own report' } : figure(result),
    ),
    comparisons: pairs.flatMap(([a, b]) => {
      const found =
        a.result === undefined || b.result === undefined
          ? undefined
          : differenceBetween(a.result, b.result, 'overall', metric)
      return found === undefined ? [] : [fromDifference(found, a.name, b.name)]
    }),
    runToRun: null,
  }))
}

/**
 * What the later columns claim against the first. A second column that claims the same says so in
 * three words, and identical sentences appear once.
 */
function claimsAgainstFirst(
  rows: readonly DashboardRow[],
  columns: readonly string[],
  nothing: string,
): string {
  const [first, ...others] = columns
  if (first === undefined) return nothing
  const sentences: string[] = []
  let lead: { side: string; words: string } | undefined
  for (const side of others) {
    const words = verdictsBetween(rows, [first, side], '')
    if (words === '' || sentences.includes(words)) continue
    if (words === lead?.words.replaceAll(lead.side, side)) {
      sentences.push(`So is ${side.toLowerCase()}.`)
      continue
    }
    lead ??= { side, words }
    sentences.push(words)
  }
  return sentences.length === 0 ? nothing : sentences.join(' ')
}

/** The first screen's retrieval, for a report with the reranker. */
function rerankRetrieval(
  report: EvalReport,
  contextual: EvalStrategyResult | undefined,
): DashboardSection | undefined {
  const hybrid = strategyOf(report, 'hybrid')
  const rerank = strategyOf(report, 'rerank')
  if (hybrid === undefined || rerank === undefined) return undefined
  const hybridSide: RetrievalSide = { name: HYBRID, result: hybrid }
  const rerankSide: RetrievalSide = { name: RERANK, result: rerank }
  const contextsSide: RetrievalSide | undefined =
    report.answers?.contextualIndex === undefined
      ? undefined
      : { name: WITH_CONTEXTS, result: contextual }
  const sides = [hybridSide, rerankSide, ...(contextsSide === undefined ? [] : [contextsSide])]
  const rows = retrievalRows(
    sides,
    sides.slice(1).map((side) => [hybridSide, side] as const),
  )
  const between =
    contextsSide === undefined
      ? ''
      : verdictsBetween(
          retrievalRows(sides, [[rerankSide, contextsSide]]),
          [RERANK, WITH_CONTEXTS],
          'Between those two, no difference holds up.',
        )
  const { rerank: used } = report.identity
  return {
    question: 'Does rerank find the right chunks higher?',
    summary: [
      claimsAgainstFirst(
        rows,
        sides.map(({ name }) => name),
        `No difference from hybrid holds up on these ${String(hybrid.overall.questions)} questions.`,
      ),
      between,
      used === undefined
        ? ''
        : `Rerank is hybrid, then ${used.model} over its top ${String(used.depth)}.`,
    ]
      .filter((sentence) => sentence !== '')
      .join(' '),
    against: HYBRID,
    columns: sides.map(({ name }) => name),
    scale: '0 to 1 (100%)',
    rows,
    showRunToRun: false,
  }
}

/** "Without docs: 36 of 40 fully correct (77-96%), may run high." */
function withoutDocsLine(values: Values, note: string | null): string | undefined {
  const figure = shareFigure(sum(values.values()), values.size)
  if (figure.kind !== 'share') return undefined
  const range = `${String(Math.round(figure.low * 100))}-${String(Math.round(figure.high * 100))}%`
  const lean = note === null ? '' : `, ${note}`
  return `Without docs: ${String(figure.count)} of ${String(figure.of)} fully correct (${range})${lean}.`
}

/** The first screen's answers, for a report with rows 4 and 5: the rows ADR-0014 decides on. */
function rerankAnswers(
  report: EvalReport,
  answers: EvalAnswers,
  judge: DashboardJudge,
  retrieval: DashboardSection,
  staysOnHybrid: string,
): DashboardSection {
  const present = rowsIn(answers)
  const rows = ([3, 4, 5] as const).filter((row) => present.includes(row))
  const pairs: RowPair[] = [
    [3, 4],
    [3, 5],
  ]
  const columns = rows.map((row) => ROW_NAMES[row])
  const view: AnswerView = { rows, fullyPairs: pairs, pairs, perColumn: true }
  const measures = answerMeasures(report, answers, judge, view)
  const shown = [
    measures.fullyCorrect,
    measures.citationsHold,
    measures.falseRefusals,
    measures.grounded,
  ].map((row) => clearNoise(row, columns))
  const between = answerMeasures(report, answers, judge, {
    ...view,
    fullyPairs: [[4, 5]],
    pairs: [[4, 5]],
  })
  const betweenWords = verdictsBetween(
    [between.fullyCorrect, between.citationsHold, between.falseRefusals].map((row) =>
      clearNoise(row, columns),
    ),
    [RERANK, WITH_CONTEXTS],
    '',
  )
  const claims = claimsAgainstFirst(shown, columns, '')
  const both = rows.includes(4) && rows.includes(5)
  const verdicts =
    claims === '' && betweenWords === ''
      ? `No difference from hybrid holds up${both ? ', and none between rerank and rerank + contexts' : ''}.`
      : [
          claims === '' ? 'No difference from hybrid holds up.' : claims,
          betweenWords === '' && both
            ? 'Between rerank and rerank + contexts, no difference holds up.'
            : betweenWords,
        ]
          .filter((sentence) => sentence !== '')
          .join(' ')

  // Said only when the numbers on this screen say it: a later run could say otherwise.
  const namesRerank = (row: DashboardRow): boolean =>
    row.comparisons.some(({ verdict }) => verdict === 'b')
  const gained = retrieval.against !== undefined && retrieval.rows.some(namesRerank)
  const reached = [measures.anchors, measures.rightRefusals, ...shown]
    .filter(({ exploratory }) => !exploratory)
    .map((row) => clearNoise(row, columns))
    .some(namesRerank)
  const withoutDocs = present.includes(0)
    ? withoutDocsLine(measures.fully(0), correctnessNote(judge))
    : undefined
  const notes = [
    ...(withoutDocs === undefined ? [] : [withoutDocs]),
    ...(gained && !reached ? [staysOnHybrid] : []),
  ]
  return {
    question: 'Does that reach the answers?',
    summary: [
      ...(judge.calibrated
        ? []
        : ['The judge is not calibrated for these prompts, so these are provisional.']),
      verdicts,
    ].join(' '),
    ...(notes.length === 0 ? {} : { notes }),
    ...(rows.includes(3) ? { against: HYBRID } : {}),
    columns,
    scale: '0 to 100%',
    rows: shown,
    showRunToRun: rows.some((row) => answeredTwice(answers, row)),
    runToRunHeader: RUN_TO_RUN_EACH,
  }
}

/** What the first screen leaves out for a report with the reranker: every strategy and row. */
function allRowsSections(
  report: EvalReport,
  judge: DashboardJudge | null,
  contextual: EvalStrategyResult | undefined,
): DashboardSection[] {
  const hybrid = strategyOf(report, 'hybrid')
  const rerank = strategyOf(report, 'rerank')
  if (hybrid === undefined || rerank === undefined) return []
  const vector = strategyOf(report, 'vector')
  const vectorSide: RetrievalSide | undefined =
    vector === undefined ? undefined : { name: 'Vector', result: vector }
  const hybridSide: RetrievalSide = { name: HYBRID, result: hybrid }
  const rerankSide: RetrievalSide = { name: RERANK, result: rerank }
  const contextsSide: RetrievalSide | undefined =
    report.answers?.contextualIndex === undefined
      ? undefined
      : { name: WITH_CONTEXTS, result: contextual }
  const sides = [
    ...(vectorSide === undefined ? [] : [vectorSide]),
    hybridSide,
    rerankSide,
    ...(contextsSide === undefined ? [] : [contextsSide]),
  ]
  const sections: DashboardSection[] = [
    {
      question: 'Every strategy: does it find the right chunks?',
      summary: 'The first screen compares only with hybrid. This is every comparison.',
      columns: sides.map(({ name }) => name),
      scale: '0 to 1 (100%)',
      rows: retrievalRows(sides, [
        ...(vectorSide === undefined ? [] : [[vectorSide, hybridSide] as const]),
        [hybridSide, rerankSide],
        ...(contextsSide === undefined
          ? []
          : [[hybridSide, contextsSide] as const, [rerankSide, contextsSide] as const]),
      ]),
      showRunToRun: false,
    },
  ]
  const { answers } = report
  if (answers === undefined || judge === null) return sections

  const rows = rowsIn(answers)
  const pairs: RowPair[] = [
    [2, 3],
    [3, 4],
    [3, 5],
    [4, 5],
  ]
  const view: AnswerView = { rows, fullyPairs: [[0, 3], ...pairs], pairs, perColumn: true }
  const measures = answerMeasures(report, answers, judge, view)
  const columns = rows.map((row) => ROW_NAMES[row])
  const shown = [
    measures.fullyCorrect,
    measures.citationsHold,
    measures.grounded,
    measures.anchors,
    measures.falseRefusals,
    measures.rightRefusals,
    { ...measures.cost, note: 'search not included' },
  ].map((row) => clearNoise(row, columns))
  sections.push({
    question: 'Every row: does it give better answers?',
    summary: [
      ...(judge.calibrated
        ? []
        : ['The judge is not calibrated for these prompts, so these are provisional.']),
      ragClaim(measures.fullyCorrect.comparisons, shown[0]?.comparisons ?? [], measures.grounds),
    ]
      .filter((sentence) => sentence !== '')
      .join(' '),
    columns,
    scale: '0 to 100%',
    rows: shown,
    showRunToRun: rows.some((row) => answeredTwice(answers, row)),
    runToRunHeader: RUN_TO_RUN_ROWS,
  })
  return sections
}

/** Which other index a report read, in words: the trust section says so, when it did. */
function otherIndexWords(report: EvalReport): string | undefined {
  const index = report.answers?.contextualIndex
  if (index !== undefined) {
    return `${WITH_CONTEXTS} read the contextual index: ${index.contextModel}.`
  }
  const compiled = report.answers?.compiledIndex
  if (compiled !== undefined) {
    return `${ROW_NAMES[7]} read the compiled index: ${compiled.compiler}.`
  }
  const { contextModel } = report.identity
  return contextModel === null || contextModel === ''
    ? undefined
    : `This run measured another index than the plain one: ${contextModel}.`
}

/**
 * Whether RAG helps, from fully correct alone, and grounding only if the answers show it. `original`
 * holds the verdicts before run-to-run noise: one that noise took away says that nothing holds up,
 * which is not the same as the two being about as correct.
 */
function ragClaim(
  original: readonly EvalSplit[],
  shown: readonly EvalSplit[],
  grounds: boolean,
): string {
  const fromNoRag = ({ a }: EvalSplit): boolean => a === ROW_NAMES[0]
  const splits = shown.filter(fromNoRag)
  if (splits.length === 0) return ''
  if (splits.every(({ verdict }) => verdict === 'too-few')) {
    return 'Too few questions to say whether RAG helps.'
  }
  const better = splits.flatMap((split) => {
    const side = namedSide(split)
    if (side === undefined) return []
    return [`${side} better than ${side === split.a ? split.b : split.a}`]
  })
  if (better.length > 0) return `On fully correct, ${better.join(' and ')}.`
  if (splits.some(({ verdict }) => verdict === 'mixed')) {
    return 'Mixed between no RAG and RAG on fully correct.'
  }
  if (original.filter(fromNoRag).every(({ verdict }) => verdict === 'noise')) {
    const about =
      'Without docs, Claude is about as correct on this set, so correctness alone does not show what RAG adds.'
    return grounds
      ? `${about} What RAG adds is grounding: most of its answers cite passages that hold.`
      : about
  }
  return 'No difference between no RAG and RAG holds up on fully correct.'
}

export interface BuildRunOptions {
  id: string
  report: EvalReport
  calibrations: readonly EvalCalibration[]
  unreadableCalibrations?: readonly string[]
  verify: EvalVerifyRecord | null
  /** The report's spot check, when it has one (ADR-0016). */
  spotCheck?: EvalSpotCheck | null
  /** What the source says beside its numbers, when it does (ADR-0015). */
  about?: EvalSourceAbout
  indexDocsSha: string | null
  /** Row 5's retrieval, from the report of its own index (ADR-0014). */
  contextual?: EvalStrategyResult | undefined
}

/** Everything on the first screen for one run. */
export function buildDashboardRun(options: BuildRunOptions): DashboardRun {
  const { id, report, calibrations, unreadableCalibrations, verify, indexDocsSha, about } = options
  const judge =
    report.answers === undefined
      ? null
      : judgeTrust(report.answers, calibrations, unreadableCalibrations, report.identity.sourceId)
  const retrieval = rerankRetrieval(report, options.contextual) ?? retrievalSection(report)
  const index = otherIndexWords(report)
  return {
    id,
    name: report.run.name ?? id,
    createdAt: report.run.createdAt,
    repoSha: report.run.repoSha,
    retrieval,
    answers:
      judge === null
        ? null
        : report.answers !== undefined && hasRerankRows(report.answers)
          ? rerankAnswers(
              report,
              report.answers,
              judge,
              retrieval,
              about?.staysOnHybrid ?? APP_STAYS_ON_HYBRID,
            )
          : answersSection(report, judge),
    trust: {
      judge,
      goldenSet: {
        ...report.identity.goldenSet,
        ...(about?.set === undefined ? {} : { about: about.set }),
      },
      docs: report.identity.docs,
      indexDocsSha,
      stale: report.result.stale,
      review: report.result.review,
      verify:
        verify === null
          ? null
          : {
              status: verify.status,
              text: verifyWords(verify, report.answers !== undefined),
              checkedAt: verify.rerun.at,
            },
      ...(index === undefined ? {} : { index }),
      ...(options.spotCheck == null ? {} : { spotCheck: spotCheckView(options.spotCheck) }),
    },
  }
}

function tagSections(
  report: EvalReport,
  judge: DashboardJudge | null,
  contextual: EvalStrategyResult | undefined,
): DashboardSection[] {
  const results = report.result.strategies
  const sides = [
    ...results.map((result) => ({ name: STRATEGY_NAMES[result.strategy], result })),
    ...(contextual === undefined ? [] : [{ name: WITH_CONTEXTS, result: contextual }]),
  ]
  const columns = sides.map(({ name }) => name)
  const tags = [...new Set(results.flatMap(({ byTag }) => Object.keys(byTag)))].sort()
  const scope = (tag: string) =>
    report.result.comparison?.scopes.find((candidate) => candidate.scope === tag)
  const compared = (tag: string, metric: ComparedMetric): EvalSplit[] => {
    const found = scope(tag)?.primary.find((difference) => difference.metric === metric)
    const hybrid = strategyOf(report, 'hybrid')
    return [
      ...(found === undefined ? [] : [fromDifference(found, 'Vector', 'Hybrid')]),
      ...sides
        .filter(({ name }) => name === RERANK || name === WITH_CONTEXTS)
        .flatMap(({ name, result }) => {
          const difference =
            hybrid === undefined ? undefined : differenceBetween(hybrid, result, tag, metric)
          return difference === undefined ? [] : [fromDifference(difference, HYBRID, name)]
        }),
    ]
  }
  const countOf = (tag: string): number => results[0]?.byTag[tag]?.questions ?? 0
  const sections: DashboardSection[] = [
    {
      question: 'Right chunk in top 8, by tag',
      summary: 'A tag of 5 questions or fewer cannot reach significance.',
      columns,
      scale: '0 to 100%',
      rows: tags.map((tag) => ({
        id: `top-8-${tag}`,
        label: tag,
        note: `${String(countOf(tag))} questions`,
        exploratory: false,
        figures: sides.map(({ result }) => {
          const metrics = result.byTag[tag]
          return metrics === undefined
            ? ({ kind: 'none', reason: 'none' } as const)
            : hitFigure(metrics, 8)
        }),
        comparisons: compared(tag, 'hit@8'),
        runToRun: null,
      })),
      showRunToRun: false,
    },
    {
      question: 'How high it ranks (MRR), by tag',
      summary: 'A tag of 5 questions or fewer cannot reach significance.',
      columns,
      scale: '0 to 1',
      rows: tags.map((tag) => ({
        id: `mrr-${tag}`,
        label: tag,
        note: `${String(countOf(tag))} questions`,
        exploratory: false,
        figures: sides.map(({ result }) => meanFigure(mrrValues(result, tag))),
        comparisons: compared(tag, 'mrr'),
        runToRun: null,
      })),
      showRunToRun: false,
    },
  ]
  const { answers } = report
  if (answers === undefined) return sections

  const grades = new Grades(answers, report.result.unanswerable)
  const rows = rowsIn(answers)
  const tagsOf = new Map(
    results.flatMap((result) =>
      result.questions.map(({ id, tags: names }) => [id, names] as const),
    ),
  )
  const inTag = (tag?: string) => (id: string) =>
    tag === undefined || (tagsOf.get(id)?.includes(tag) ?? false)
  const second = hasSecondRun(answers)
  const fully = (row: AnswerRow, tag?: string, sample = 1): Values =>
    grades.valuesOf(row, sample, ({ correctness }) => (correctness === 2 ? 1 : 0), inTag(tag))
  const score = (row: AnswerRow, tag?: string, sample = 1): Values =>
    grades.valuesOf(row, sample, ({ correctness }) => correctness ?? 0, inTag(tag))
  const pairs: RowPair[] = (
    [
      [2, 3],
      [0, 3],
      [3, 4],
      [3, 5],
    ] as RowPair[]
  ).filter(([a, b]) => rows.includes(a) && rows.includes(b))
  const perColumn = hasRerankRows(answers)
  const answerColumns = rows.map((row) => ROW_NAMES[row])
  // The same rule as the first screen, on the same data (ADR-0013).
  const measured = (values: (row: AnswerRow, sample: number) => Values): MeasuredRow =>
    clearNoise(
      {
        comparisons: pairs.map(([a, b]) =>
          splitOf(ROW_NAMES[a], values(a, 1), ROW_NAMES[b], values(b, 1)),
        ),
        ...(perColumn
          ? {
              runToRun: null,
              runToRuns: rows.map((row) =>
                answeredTwice(answers, row) ? differing(values(row, 1), values(row, 2)) : null,
              ),
            }
          : { runToRun: second ? differing(values(3, 1), values(3, 2)) : null }),
      },
      answerColumns,
    )
  const runToRunHeader = perColumn ? { runToRunHeader: RUN_TO_RUN_ROWS } : {}
  const note = correctnessNote(judge)
  const noteFor = (tag: string): string =>
    [`${String(countOf(tag))} questions`, ...(note === null ? [] : [note])].join(', ')

  sections.push(
    {
      question: 'Fully correct, by tag',
      summary: 'A tag of 5 questions or fewer cannot reach significance.',
      columns: rows.map((row) => ROW_NAMES[row]),
      scale: '0 to 100%',
      rows: tags.map((tag) => ({
        id: `fully-${tag}`,
        label: tag,
        note: noteFor(tag),
        exploratory: false,
        figures: rows.map((row) => {
          const values = fully(row, tag)
          return shareFigure(sum(values.values()), values.size)
        }),
        ...measured((row, sample) => fully(row, tag, sample)),
      })),
      showRunToRun: second,
      ...runToRunHeader,
    },
    {
      question: 'Correctness score, 0 to 2',
      summary: 'The score keeps its own comparison: 1 and 0 count as different here.',
      columns: rows.map((row) => ROW_NAMES[row]),
      scale: '0 to 2',
      rows: [undefined, ...tags].map((tag) => ({
        id: `score-${tag ?? 'overall'}`,
        label: tag ?? 'All questions',
        ...(tag === undefined ? (note === null ? {} : { note }) : { note: noteFor(tag) }),
        exploratory: false,
        figures: rows.map((row) => meanFigure([...score(row, tag).values()], 2)),
        ...measured((row, sample) => score(row, tag, sample)),
      })),
      showRunToRun: second,
      ...runToRunHeader,
    },
  )
  return sections
}

function gradeWords(verdict: EvalVerdict | undefined): string {
  if (verdict?.status !== 'ok') return '-'
  if (verdict.outcome === 'correct-refusal') return 'Refused rightly'
  if (verdict.outcome === 'hallucination') return 'Hallucination'
  if (verdict.outcome === 'wrong') return 'Wrong'
  if (verdict.falseRefusal === true) return 'Refused'
  if (verdict.correctness === 2) return 'Fully correct'
  if (verdict.correctness === 1) return 'Partly correct'
  if (verdict.correctness === 0) return 'Wrong'
  return '-'
}

function questionRows(
  report: EvalReport,
  questions: readonly GoldenQuestion[],
  contextual: EvalStrategyResult | undefined,
): DashboardQuestion[] {
  const { answers } = report
  const rows = answers === undefined ? [] : rowsIn(answers)
  const results = report.result.strategies
  return questions.map((question): DashboardQuestion => {
    const rankIn = (result: EvalStrategyResult): number | null =>
      result.questions.find(({ id }) => id === question.id)?.primaryRank ?? null
    const ranks = [
      ...results.map((result) => ({
        column: STRATEGY_NAMES[result.strategy],
        rank: rankIn(result),
      })),
      ...(contextual === undefined ? [] : [{ column: WITH_CONTEXTS, rank: rankIn(contextual) }]),
    ]
    const grades = rows.map((row) => ({
      column: ROW_NAMES[row],
      grade: gradeWords(
        answers?.verdicts.find(
          (verdict) =>
            verdict.questionId === question.id &&
            verdict.row === row &&
            verdict.sample === 1 &&
            verdict.judgeSample === 1,
        ),
      ),
    }))
    return {
      id: question.id,
      question: question.question,
      tags: question.tags,
      ranks,
      answers: grades,
      differs:
        new Set(ranks.map(({ rank }) => rank)).size > 1 ||
        new Set(grades.map(({ grade }) => grade)).size > 1,
    }
  })
}

export interface BuildDetailsOptions {
  report: EvalReport
  questions: readonly GoldenQuestion[]
  calibrations: readonly EvalCalibration[]
  unreadableCalibrations?: readonly string[]
  /** Row 5's retrieval, from the report of its own index (ADR-0014). */
  contextual?: EvalStrategyResult | undefined
}

/** What opens behind the first screen. */
export function buildDashboardDetails(options: BuildDetailsOptions): DashboardDetails {
  const { report, questions, calibrations, unreadableCalibrations, contextual } = options
  const judge =
    report.answers === undefined
      ? null
      : judgeTrust(report.answers, calibrations, unreadableCalibrations, report.identity.sourceId)
  const allRows = allRowsSections(report, judge, contextual)
  return {
    ...(allRows.length === 0 ? {} : { allRows }),
    tags: tagSections(report, judge, contextual),
    questions: questionRows(report, questions, contextual),
    gradeNote: correctnessNote(judge),
    candidates: (report.answers?.candidates ?? []).map((candidate): DashboardCandidate => ({
      questionId: candidate.questionId,
      column: ROW_NAMES[candidate.row],
      chunkId: candidate.chunkId,
      docPath: candidate.docPath,
    })),
  }
}

/** Two runs side by side (SPEC section 3). Two set versions are never compared (ADR-0009). */
export function compareDashboardRuns(a: EvalReport, b: EvalReport): DashboardRunComparison {
  const nameOf = (report: EvalReport): string => report.run.name ?? report.run.repoSha.slice(0, 8)
  const [nameA, nameB] = [nameOf(a), nameOf(b)]
  const setA = a.identity.goldenSet
  const setB = b.identity.goldenSet
  if (setA.version !== setB.version) {
    return {
      comparable: false,
      reason: `These runs used golden set versions ${String(setA.version)} and ${String(setB.version)}, and numbers from two versions are never compared.`,
    }
  }
  if (setA.hash !== setB.hash) {
    return {
      comparable: false,
      reason: `These runs both say golden set version ${String(setA.version)}, with different contents, so one of them cannot be trusted.`,
    }
  }
  const labels = nameA === nameB ? { a: `${nameA} (1)`, b: `${nameB} (2)` } : { a: nameA, b: nameB }
  const rows: DashboardRow[] = []
  const moved: Extract<DashboardRunComparison, { comparable: true }>['moved'] = []
  for (const before of a.result.strategies) {
    const after = strategyOf(b, before.strategy)
    if (after === undefined) continue
    const name = STRATEGY_NAMES[before.strategy]
    const compared = compareScores(
      { name: labels.a, questions: before.questions },
      { name: labels.b, questions: after.questions },
    ).scopes.find(({ scope }) => scope === 'overall')?.primary
    const split = (metric: ComparedMetric): EvalSplit[] => {
      const found = compared?.find((difference) => difference.metric === metric)
      return found === undefined ? [] : [fromDifference(found, labels.a, labels.b)]
    }
    rows.push(
      {
        id: `${before.strategy}-top-8`,
        label: `${name}: right chunk in top 8`,
        exploratory: false,
        figures: [hitFigure(before.overall, 8), hitFigure(after.overall, 8)],
        comparisons: split('hit@8'),
        runToRun: null,
      },
      {
        id: `${before.strategy}-mrr`,
        label: `${name}: how high it ranks (MRR)`,
        exploratory: false,
        figures: [meanFigure(mrrValues(before)), meanFigure(mrrValues(after))],
        comparisons: split('mrr'),
        runToRun: null,
      },
    )
    const later = new Map(after.questions.map((question) => [question.id, question]))
    for (const question of before.questions) {
      const other = later.get(question.id)
      if (other !== undefined && other.primaryRank !== question.primaryRank) {
        moved.push({
          strategy: name,
          questionId: question.id,
          from: question.primaryRank,
          to: other.primaryRank,
        })
      }
    }
  }
  return {
    comparable: true,
    a: labels.a,
    b: labels.b,
    differences: [
      ...fieldDifferences('identity', a.identity, b.identity, labels),
      ...fieldDifferences('vectors', a.vectors, b.vectors, labels),
    ],
    section: {
      question: `${labels.a} against ${labels.b}`,
      summary:
        moved.length === 0
          ? 'No right chunk moved.'
          : `${String(moved.length)} right chunks moved.`,
      columns: [labels.a, labels.b],
      scale: '0 to 1 (100%)',
      rows,
      showRunToRun: false,
    },
    moved,
  }
}
