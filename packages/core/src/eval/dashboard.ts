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

export function shareFigure(count: number, of: number): EvalFigure {
  const [low, high] = wilsonInterval(count, of)
  return { kind: 'share', count, of, low, high }
}

export function meanFigure(values: readonly number[]): EvalFigure {
  const { value, low, high } = bootstrapMean(values)
  return { kind: 'mean', value, of: values.length, low, high }
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

/** How many questions differ between two samples. */
function differing(a: Values, b: Values): number {
  return [...a].filter(([id, value]) => {
    const other = b.get(id)
    return other !== undefined && other !== value
  }).length
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
  const winners = rows.flatMap(({ comparisons }) =>
    comparisons.flatMap((split) => namedSide(split) ?? []),
  )
  const n = results[0]?.overall.questions ?? 0
  return {
    question: 'Does hybrid find the right chunks more often?',
    summary:
      winners.length === 0
        ? `No difference holds up on these ${String(n)} questions.`
        : `${[...new Set(winners)].join(' and ')} ahead, on ${String(n)} questions.`,
    columns,
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
            item.claims.length > 0,
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
  const shareOf = (values: Values): EvalFigure => shareFigure(sum(values.values()), values.size)
  const runToRun = (values: (row: AnswerRow, sample: number) => Values): number | null =>
    second ? differing(values(3, 1), values(3, 2)) : null

  const fullyCorrect: DashboardRow = {
    id: 'fully-correct',
    label: 'Fully correct',
    ...(judge.note === null ? {} : { note: judge.note }),
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
    label: 'Refused, though the docs answer it',
    exploratory: false,
    figures: rows.map((row) => shareOf(refusedWithAnswer(row))),
    comparisons: compareRows(refusedWithAnswer, [[2, 3]]),
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

  const named = (from: AnswerRow) =>
    fullyCorrect.comparisons
      .filter(({ a }) => a === ROW_NAMES[from])
      .flatMap((split) => namedSide(split) ?? [])
  const ragClaim =
    named(0).length === 0
      ? 'Without docs, Claude is about as correct on this set, so correctness alone does not show what RAG adds. What RAG adds is grounding.'
      : `${[...new Set(named(0))].join(' and ')} ahead between no RAG and RAG on correctness.`
  const between = fullyCorrect.comparisons.find(({ a, b }) => a === 'Vector' && b === 'Hybrid')
  const hybridClaim =
    between === undefined || namedSide(between) === undefined
      ? 'No difference between vector and hybrid holds up.'
      : `${String(namedSide(between))} ahead between vector and hybrid.`

  return {
    question: 'Does it give better answers, and does RAG help at all?',
    summary: `${hybridClaim} ${ragClaim}`,
    columns: rows.map((row) => ROW_NAMES[row]),
    rows: [fullyCorrect, citationsHold, grounded, anchors, falseRefusals, rightRefusals, cost],
    showRunToRun: second,
  }
}

export interface BuildRunOptions {
  id: string
  report: EvalReport
  calibrations: readonly EvalCalibration[]
  verify: EvalVerifyRecord | null
  indexDocsSha: string | null
}

/** Everything on the first screen for one run. */
export function buildDashboardRun(options: BuildRunOptions): DashboardRun {
  const { id, report, calibrations, verify, indexDocsSha } = options
  const judge = report.answers === undefined ? null : judgeTrust(report.answers, calibrations)
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
  const fully = (row: AnswerRow, tag?: string): Values =>
    grades.valuesOf(row, 1, ({ correctness }) => (correctness === 2 ? 1 : 0), inTag(tag))
  const score = (row: AnswerRow, tag?: string): Values =>
    grades.valuesOf(row, 1, ({ correctness }) => correctness ?? 0, inTag(tag))
  const pairs: [AnswerRow, AnswerRow][] = (
    [
      [2, 3],
      [0, 3],
    ] as [AnswerRow, AnswerRow][]
  ).filter(([a, b]) => rows.includes(a) && rows.includes(b))
  const splits = (values: (row: AnswerRow) => Values): EvalSplit[] =>
    pairs.map(([a, b]) => splitOf(ROW_NAMES[a], values(a), ROW_NAMES[b], values(b)))
  const noteFor = (tag: string): string =>
    [`${String(countOf(tag))} questions`, ...(judge?.note == null ? [] : [judge.note])].join(', ')

  sections.push(
    {
      question: 'Fully correct, by tag',
      summary: 'A tag of 5 questions or fewer cannot reach significance.',
      columns: rows.map((row) => ROW_NAMES[row]),
      rows: tags.map((tag) => ({
        id: `fully-${tag}`,
        label: tag,
        note: noteFor(tag),
        exploratory: false,
        figures: rows.map((row) => {
          const values = fully(row, tag)
          return shareFigure(sum(values.values()), values.size)
        }),
        comparisons: splits((row) => fully(row, tag)),
        runToRun: null,
      })),
      showRunToRun: false,
    },
    {
      question: 'Correctness score, 0 to 2',
      summary: 'The score keeps its own comparison: 1 and 0 count as different here.',
      columns: rows.map((row) => ROW_NAMES[row]),
      rows: [undefined, ...tags].map((tag) => ({
        id: `score-${tag ?? 'overall'}`,
        label: tag ?? 'All questions',
        ...(tag === undefined
          ? judge?.note == null
            ? {}
            : { note: judge.note }
          : { note: noteFor(tag) }),
        exploratory: false,
        figures: rows.map((row) => meanFigure([...score(row, tag).values()])),
        comparisons: splits((row) => score(row, tag)),
        runToRun: null,
      })),
      showRunToRun: false,
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
}

/** What opens behind the first screen. */
export function buildDashboardDetails(options: BuildDetailsOptions): DashboardDetails {
  const { report, questions, calibrations } = options
  const judge = report.answers === undefined ? null : judgeTrust(report.answers, calibrations)
  return {
    tags: tagSections(report, judge),
    questions: questionRows(report, questions),
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
      rows,
      showRunToRun: false,
    },
    moved,
  }
}
