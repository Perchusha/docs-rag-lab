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
import { judgeTrust, verifyWords } from './trust.ts'
import { fieldDifferences } from './verify.ts'

const STRATEGY_NAMES: Record<Strategy, string> = { vector: 'Vector', hybrid: 'Hybrid' }
const ROW_NAMES: Record<AnswerRow, string> = { 0: 'No RAG', 2: 'Vector', 3: 'Hybrid' }
const ROWS: readonly AnswerRow[] = [0, 2, 3]

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

const fromDifference = (d: MetricDifference, a: string, b: string): EvalSplit => ({
  a,
  b,
  aAhead: d.aBetter,
  bAhead: d.bBetter,
  tied: d.tied,
  p: d.p,
  verdict: d.verdict,
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

function storedRow(
  answers: EvalAnswers,
  metric: AnswerComparedMetric,
): Pick<DashboardRow, 'comparisons' | 'runToRun'> {
  const between = storedDifference(answers, 'row 2', 'row 3', metric)
  const again = storedDifference(answers, 'row 3', 'row 3 again', metric)
  return {
    comparisons:
      between === undefined
        ? []
        : [
            {
              a: 'Vector',
              b: 'Hybrid',
              aAhead: between.aBetter,
              bAhead: between.bBetter,
              tied: between.tied,
              p: between.p,
              verdict: between.verdict,
            },
          ],
    runToRun: again === undefined ? null : again.aBetter + again.bBetter,
  }
}

function answersSection(report: EvalReport, judge: DashboardJudge): DashboardSection | null {
  const { answers } = report
  if (answers === undefined) return null
  const grades = new Grades(answers, report.result.unanswerable)
  const rows = rowsIn(answers)
  const second = hasSecondRun(answers)
  const resultOf = (row: AnswerRow) =>
    answers.rows.find((result) => result.row === row && result.sample === 1)

  const compareRows = (values: (row: AnswerRow) => Values, pairs: [AnswerRow, AnswerRow][]) =>
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
  const runToRun = (values: (row: AnswerRow, sample: number) => Values): number | null =>
    second ? differing(values(3, 1), values(3, 2)) : null
  const note = correctnessNote(judge)
  const withNote = note === null ? {} : { note }

  const fullyCorrect: DashboardRow = {
    id: 'fully-correct',
    label: 'Fully correct',
    ...withNote,
    exploratory: false,
    figures: rows.map((row) => shareOf(fully(row))),
    comparisons: compareRows(fully, [
      [2, 3],
      [0, 2],
      [0, 3],
    ]),
    runToRun: runToRun(fully),
  }
  const citationsHold: DashboardRow = {
    id: 'citations-hold',
    label: 'All citations hold',
    exploratory: false,
    figures: rows.map((row) => (row === 0 ? NO_DOCS : shareOf(grades.citationsHold(row, 1)))),
    comparisons: compareRows((row) => grades.citationsHold(row, 1), [[2, 3]]),
    runToRun: second ? differing(grades.citationsHold(3, 1), grades.citationsHold(3, 2)) : null,
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
    ...storedRow(answers, 'correct-and-grounded'),
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
    ...storedRow(answers, 'citation-accuracy'),
  }
  const falseRefusals: DashboardRow = {
    id: 'false-refusals',
    label: 'Wrongly refused',
    note: 'fewer is better',
    exploratory: false,
    figures: rows.map((row) => shareOf(refusedWithAnswer(row))),
    comparisons: compareRows(answeredWithAnswer, [[2, 3]]),
    runToRun: runToRun(refusedWithAnswer),
  }
  const rightRefusals: DashboardRow = {
    id: 'right-refusals',
    label: 'Refused rightly',
    exploratory: false,
    figures: rows.map((row) => shareOf(grades.refused(row, 1))),
    comparisons: compareRows((row) => grades.refused(row, 1), [[2, 3]]),
    runToRun: second ? differing(grades.refused(3, 1), grades.refused(3, 2)) : null,
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

  const sectionRows = [
    fullyCorrect,
    citationsHold,
    grounded,
    anchors,
    falseRefusals,
    rightRefusals,
    cost,
  ].map((row) => ({
    ...row,
    comparisons: row.comparisons.map((split) => againstItself(split, row.runToRun)),
  }))
  // Grounding is claimed only when the answers show it: on most answers, past the interval, the
  // citations hold. An answer with no citation counts against it.
  const grounds = rows
    .filter((row) => row !== 0)
    .every((row) => {
      const [low] = wilsonInterval(sum(grades.citationsHold(row, 1).values()), fully(row).size)
      return low > 0.5
    })
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
      ragClaim(fullyCorrect.comparisons, sectionRows[0]?.comparisons ?? [], grounds),
    ]
      .filter((sentence) => sentence !== '')
      .join(' '),
    columns: rows.map((row) => ROW_NAMES[row]),
    scale: '0 to 100%',
    rows: sectionRows,
    showRunToRun: second,
  }
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
  indexDocsSha: string | null
}

/** Everything on the first screen for one run. */
export function buildDashboardRun(options: BuildRunOptions): DashboardRun {
  const { id, report, calibrations, unreadableCalibrations, verify, indexDocsSha } = options
  const judge =
    report.answers === undefined
      ? null
      : judgeTrust(report.answers, calibrations, unreadableCalibrations)
  return {
    id,
    name: report.run.name ?? id,
    createdAt: report.run.createdAt,
    repoSha: report.run.repoSha,
    retrieval: retrievalSection(report),
    answers: judge === null ? null : answersSection(report, judge),
    trust: {
      judge,
      goldenSet: report.identity.goldenSet,
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
    },
  }
}

function tagSections(report: EvalReport, judge: DashboardJudge | null): DashboardSection[] {
  const results = report.result.strategies
  const columns = results.map(({ strategy }) => STRATEGY_NAMES[strategy])
  const tags = [...new Set(results.flatMap(({ byTag }) => Object.keys(byTag)))].sort()
  const scope = (tag: string) =>
    report.result.comparison?.scopes.find((candidate) => candidate.scope === tag)
  const compared = (tag: string, metric: ComparedMetric): EvalSplit[] => {
    const found = scope(tag)?.primary.find((difference) => difference.metric === metric)
    return found === undefined ? [] : [fromDifference(found, 'Vector', 'Hybrid')]
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
        figures: results.map((result) => {
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
        figures: results.map((result) => meanFigure(mrrValues(result, tag))),
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
  const pairs: [AnswerRow, AnswerRow][] = (
    [
      [2, 3],
      [0, 3],
    ] as [AnswerRow, AnswerRow][]
  ).filter(([a, b]) => rows.includes(a) && rows.includes(b))
  // The same rule as the first screen, on the same data (ADR-0013).
  const measured = (
    values: (row: AnswerRow, sample: number) => Values,
  ): Pick<DashboardRow, 'comparisons' | 'runToRun'> => {
    const runToRun = second ? differing(values(3, 1), values(3, 2)) : null
    return {
      comparisons: pairs.map(([a, b]) =>
        againstItself(splitOf(ROW_NAMES[a], values(a, 1), ROW_NAMES[b], values(b, 1)), runToRun),
      ),
      runToRun,
    }
  }
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
): DashboardQuestion[] {
  const { answers } = report
  const rows = answers === undefined ? [] : rowsIn(answers)
  const results = report.result.strategies
  return questions.map((question): DashboardQuestion => {
    const ranks = results.map((result) => ({
      column: STRATEGY_NAMES[result.strategy],
      rank: result.questions.find(({ id }) => id === question.id)?.primaryRank ?? null,
    }))
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
}

/** What opens behind the first screen. */
export function buildDashboardDetails(options: BuildDetailsOptions): DashboardDetails {
  const { report, questions, calibrations, unreadableCalibrations } = options
  const judge =
    report.answers === undefined
      ? null
      : judgeTrust(report.answers, calibrations, unreadableCalibrations)
  return {
    tags: tagSections(report, judge),
    questions: questionRows(report, questions),
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
