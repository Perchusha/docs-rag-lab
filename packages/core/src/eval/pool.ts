// ADR-0019's test reads two rows over several reports' questions together: `drl eval pool`.
// It reads committed reports and calls nothing. Fully correct is counted here from the answers,
// where an answer that did not finish counts as not fully correct, since a report leaves such a
// question out of its own comparisons and that would help the side that failed. The guards are
// summed from each report's own comparisons, which pair questions as the report does.
import {
  POOLED_METRICS,
  type AnswerComparison,
  type AnswerRow,
  type DifferenceVerdict,
  type EvalAnswers,
  type EvalPooled,
  type EvalPooledMetric,
  type EvalReport,
  type PooledMetric,
} from '@docs-rag-lab/contracts'

import { signTest, verdictOf } from './compare.ts'
import { roundMean } from './metrics.ts'

/** Thrown when a report cannot take part in the test. */
export class PoolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PoolError'
  }
}

interface Split {
  questions: number
  aBetter: number
  bBetter: number
  tied: number
  /** Totals of each side's values, for the verdict's check of who is ahead. */
  aTotal: number
  bTotal: number
}

const label = (row: AnswerRow, sample = 1): string =>
  `row ${String(row)}${sample > 1 ? ' again' : ''}`

function answersOf(report: EvalReport): EvalAnswers {
  if (report.answers === undefined) {
    throw new PoolError(`the report of ${report.identity.sourceId} has no answers`)
  }
  return report.answers
}

/** 1 when the answer finished and its first verdict scores 2, else 0. Missing counts as 0. */
function fullyCorrect(
  answers: EvalAnswers,
  row: AnswerRow,
  sample: number,
): (questionId: string) => number {
  const finished = new Set(
    answers.answers
      .filter((answer) => answer.row === row && answer.sample === sample && answer.status === 'ok')
      .map((answer) => answer.questionId),
  )
  const right = new Set(
    answers.verdicts
      .filter(
        (verdict) =>
          verdict.row === row &&
          verdict.sample === sample &&
          verdict.judgeSample === 1 &&
          verdict.status === 'ok' &&
          verdict.correctness === 2,
      )
      .map((verdict) => verdict.questionId),
  )
  return (id) => (finished.has(id) && right.has(id) ? 1 : 0)
}

function hasSample(answers: EvalAnswers, row: AnswerRow, sample: number): boolean {
  return answers.answers.some((answer) => answer.row === row && answer.sample === sample)
}

/** The answerable questions either row answered, in order. */
function answerableIds(report: EvalReport, a: AnswerRow, b: AnswerRow): string[] {
  const unanswerable = new Set(report.result.unanswerable)
  return [
    ...new Set(
      answersOf(report)
        .answers.filter((answer) => answer.row === a || answer.row === b)
        .map((answer) => answer.questionId),
    ),
  ]
    .filter((id) => !unanswerable.has(id))
    .sort()
}

function fullySplit(report: EvalReport, a: AnswerRow, b: AnswerRow): Split {
  const answers = answersOf(report)
  const valueA = fullyCorrect(answers, a, 1)
  const valueB = fullyCorrect(answers, b, 1)
  const ids = answerableIds(report, a, b)
  const pairs = ids.map((id) => [valueA(id), valueB(id)] as const)
  return {
    questions: pairs.length,
    aBetter: pairs.filter(([x, y]) => x > y).length,
    bBetter: pairs.filter(([x, y]) => y > x).length,
    tied: pairs.filter(([x, y]) => x === y).length,
    aTotal: pairs.reduce((sum, [x]) => sum + x, 0),
    bTotal: pairs.reduce((sum, [, y]) => sum + y, 0),
  }
}

/** Questions on which a row's two answers differ on fully correct, or null if it answered once. */
function fullyRunToRun(report: EvalReport, row: AnswerRow, a: AnswerRow, b: AnswerRow) {
  const answers = answersOf(report)
  if (!hasSample(answers, row, 2)) return null
  const first = fullyCorrect(answers, row, 1)
  const second = fullyCorrect(answers, row, 2)
  return answerableIds(report, a, b).filter((id) => first(id) !== second(id)).length
}

function comparisonOf(answers: EvalAnswers, a: string, b: string): AnswerComparison | undefined {
  return answers.comparisons.find((comparison) => comparison.a === a && comparison.b === b)
}

function storedDifference(answers: EvalAnswers, a: string, b: string, metric: PooledMetric) {
  return comparisonOf(answers, a, b)
    ?.scopes.find((scope) => scope.scope === 'overall')
    ?.differences.find((difference) => difference.metric === metric)
}

/** A guard as a report compared it, or undefined when it did not, as row 0 has no citations. */
function storedSplit(
  report: EvalReport,
  a: AnswerRow,
  b: AnswerRow,
  metric: PooledMetric,
): Split | undefined {
  const found = storedDifference(answersOf(report), label(a), label(b), metric)
  if (found === undefined) return undefined
  const questions = found.aBetter + found.bBetter + found.tied
  return {
    questions,
    aBetter: found.aBetter,
    bBetter: found.bBetter,
    tied: found.tied,
    aTotal: found.a * questions,
    bTotal: found.b * questions,
  }
}

function storedRunToRun(report: EvalReport, row: AnswerRow, metric: PooledMetric) {
  const found = storedDifference(answersOf(report), label(row), label(row, 2), metric)
  return found === undefined ? null : found.aBetter + found.bBetter
}

/** The sum over reports, or null when any report has none. */
function sumOrNull(values: readonly (number | null)[]): number | null {
  return values.some((value) => value === null)
    ? null
    : values.reduce<number>((sum, value) => sum + (value ?? 0), 0)
}

/** The sign test's verdict, then ADR-0013's rule: a margin up to twice the larger run to run is noise. */
function pooledMetric(
  metric: PooledMetric,
  splits: readonly Split[],
  runToRun: { a: number | null; b: number | null },
): EvalPooledMetric {
  const total = (pick: (split: Split) => number): number =>
    splits.reduce((sum, split) => sum + pick(split), 0)
  const questions = total((split) => split.questions)
  const aBetter = total((split) => split.aBetter)
  const bBetter = total((split) => split.bBetter)
  const p = signTest(aBetter, bBetter)
  const named: DifferenceVerdict = verdictOf({
    questions,
    aBetter,
    bBetter,
    p,
    a: total((split) => split.aTotal),
    b: total((split) => split.bTotal),
  })
  const bar = Math.max(runToRun.a ?? 0, runToRun.b ?? 0)
  const noise = (named === 'a' || named === 'b') && Math.abs(aBetter - bBetter) <= 2 * bar
  return {
    metric,
    questions,
    aBetter,
    bBetter,
    tied: total((split) => split.tied),
    p: roundMean(p),
    runToRun,
    verdict: noise ? 'noise' : named,
  }
}

/** Row a against row b over every report's answerable questions together (ADR-0019). */
export function poolReports(
  reports: readonly EvalReport[],
  a: AnswerRow,
  b: AnswerRow,
): EvalPooled {
  if (reports.length === 0) throw new PoolError('the test needs at least one report')
  for (const report of reports) {
    const answers = answersOf(report)
    for (const row of [a, b]) {
      if (!hasSample(answers, row, 1)) {
        throw new PoolError(`the report of ${report.identity.sourceId} has no ${label(row)}`)
      }
    }
  }
  const guard = (metric: PooledMetric): EvalPooledMetric[] => {
    const splits = reports.map((report) => storedSplit(report, a, b, metric))
    // No report could compare it, as for a row that cites nothing: the test has no such guard.
    if (splits.every((split) => split === undefined)) return []
    const missing = reports.find((_, i) => splits[i] === undefined)
    if (missing !== undefined) {
      throw new PoolError(
        `the report of ${missing.identity.sourceId} compares no ${label(a)} with ${label(b)} on ${metric}`,
      )
    }
    return [
      pooledMetric(
        metric,
        splits.filter((split): split is Split => split !== undefined),
        {
          a: sumOrNull(reports.map((report) => storedRunToRun(report, a, metric))),
          b: sumOrNull(reports.map((report) => storedRunToRun(report, b, metric))),
        },
      ),
    ]
  }
  const metrics = POOLED_METRICS.flatMap((metric) =>
    metric === 'fully-correct'
      ? [
          pooledMetric(
            metric,
            reports.map((report) => fullySplit(report, a, b)),
            {
              a: sumOrNull(reports.map((report) => fullyRunToRun(report, a, a, b))),
              b: sumOrNull(reports.map((report) => fullyRunToRun(report, b, a, b))),
            },
          ),
        ]
      : guard(metric),
  )
  const notOk = reports.flatMap((report) =>
    answersOf(report)
      .answers.filter((answer) => (answer.row === a || answer.row === b) && answer.sample === 1)
      .filter((answer) => answer.status !== 'ok')
      .map((answer) => ({
        sourceId: report.identity.sourceId,
        questionId: answer.questionId,
        row: answer.row,
        status: answer.status,
      })),
  )
  const hallucinations = reports.flatMap((report) =>
    answersOf(report)
      .verdicts.filter(
        (verdict) =>
          verdict.row === b &&
          verdict.sample === 1 &&
          verdict.judgeSample === 1 &&
          verdict.outcome === 'hallucination',
      )
      .map((verdict) => ({ sourceId: report.identity.sourceId, questionId: verdict.questionId })),
  )
  const verdictOfMetric = (metric: PooledMetric) =>
    metrics.find((found) => found.metric === metric)?.verdict
  return {
    reports: reports.map((report) => ({
      sourceId: report.identity.sourceId,
      name: report.run.name,
      repoSha: report.run.repoSha,
      createdAt: report.run.createdAt,
      goldenSet: report.identity.goldenSet,
    })),
    a,
    b,
    metrics,
    notOk,
    hallucinations,
    holds:
      verdictOfMetric('fully-correct') === 'b' && metrics.every(({ verdict }) => verdict !== 'a'),
  }
}
