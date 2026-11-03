// Are two sets of scores different, or is that noise? (SPEC section 10, ADR-0010.)
// Forty questions cannot resolve small differences, so scores are compared question
// by question with an exact sign test, overall and per tag. A difference of one or
// two questions is noise whatever the test says, a larger one needs p < 0.05, and a
// scope of 5 questions or fewer cannot reach that at all, so it is marked as too few.
// Wins alone do not name a winner: ten small wins can lose to two large defeats.
import {
  COMPARED_METRICS,
  type ComparedMetric,
  type DifferenceVerdict,
  type EvalComparison,
  type EvalMetrics,
  type EvalQuestionScore,
  type HitCutoff,
  type MetricDifference,
  type RankMetrics,
  type ScopeComparison,
} from '@docs-rag-lab/contracts'

import { metricsOf, reciprocal, roundMean, tagsOf } from './metrics.ts'

/** 5 of 5 is p = 0.0625, so a scope this small can never reach significance. */
export const TOO_FEW_QUESTIONS = 5

/** A difference this small is noise whatever the test says (the owner's rule for 40 questions). */
const NOISE_QUESTIONS = 2

const SIGNIFICANCE = 0.05

function binomial(n: number, k: number): number {
  let result = 1
  for (let i = 1; i <= k; i++) result = (result * (n - k + i)) / i
  return result
}

/** The exact two-sided sign test: how likely is a split this uneven if neither side is better? */
export function signTest(aBetter: number, bBetter: number): number {
  const n = aBetter + bBetter
  if (n === 0) return 1
  let tail = 0
  for (let i = 0; i <= Math.min(aBetter, bBetter); i++) tail += binomial(n, i)
  return Math.min(1, roundMean((2 * tail) / 2 ** n))
}

export function verdictOf(options: {
  questions: number
  aBetter: number
  bBetter: number
  p: number
  /** The totals the report prints beside the verdict. */
  a: number
  b: number
}): DifferenceVerdict {
  const { questions, aBetter, bBetter, p, a, b } = options
  if (questions <= TOO_FEW_QUESTIONS) return 'too-few'
  if (Math.abs(aBetter - bBetter) <= NOISE_QUESTIONS) return 'noise'
  if (p >= SIGNIFICANCE) return 'not-significant'
  const winner = aBetter > bBetter ? 'a' : 'b'
  const ahead = a === b ? undefined : a > b ? 'a' : 'b'
  return ahead === winner ? winner : 'mixed'
}

type Grade = 'primary' | 'withAcceptable'

function rankOf(score: EvalQuestionScore, grade: Grade): number | null {
  return grade === 'primary' ? score.primaryRank : score.acceptableRank
}

/** What one question scored on one metric. */
function questionValue(score: EvalQuestionScore, metric: ComparedMetric, grade: Grade): number {
  if (metric === 'recall@8') return score.recallAt8
  const rank = rankOf(score, grade)
  if (metric === 'mrr') return reciprocal(rank)
  const k = Number(metric.slice('hit@'.length))
  return rank !== null && rank <= k ? 1 : 0
}

/** The figure a report prints for a group: a count for hit@k, a mean otherwise. */
function groupValue(metrics: EvalMetrics, metric: ComparedMetric, grade: Grade): number {
  if (metric === 'recall@8') return metrics.recallAt8
  const ranks: RankMetrics = metrics[grade]
  if (metric === 'mrr') return ranks.mrr
  return ranks.hits[Number(metric.slice('hit@'.length)) as HitCutoff]
}

interface Pair {
  a: EvalQuestionScore
  b: EvalQuestionScore
}

function difference(
  metric: ComparedMetric,
  grade: Grade,
  pairs: readonly Pair[],
  metricsA: EvalMetrics,
  metricsB: EvalMetrics,
): MetricDifference {
  let aBetter = 0
  let bBetter = 0
  for (const { a, b } of pairs) {
    const valueA = questionValue(a, metric, grade)
    const valueB = questionValue(b, metric, grade)
    if (valueA > valueB) aBetter++
    else if (valueB > valueA) bBetter++
  }
  const p = signTest(aBetter, bBetter)
  const a = groupValue(metricsA, metric, grade)
  const b = groupValue(metricsB, metric, grade)
  return {
    metric,
    a,
    b,
    aBetter,
    bBetter,
    tied: pairs.length - aBetter - bBetter,
    p,
    verdict: verdictOf({ questions: pairs.length, aBetter, bBetter, p, a, b }),
  }
}

function scopeComparison(scope: string, pairs: readonly Pair[]): ScopeComparison {
  const metricsA = metricsOf(pairs.map(({ a }) => a))
  const metricsB = metricsOf(pairs.map(({ b }) => b))
  const all = (grade: Grade): MetricDifference[] =>
    COMPARED_METRICS.map((metric) => difference(metric, grade, pairs, metricsA, metricsB))
  return {
    scope,
    questions: pairs.length,
    primary: all('primary'),
    // recall@8 counts primary anchors only, so it is not repeated here.
    withAcceptable: all('withAcceptable').filter(({ metric }) => metric !== 'recall@8'),
  }
}

/**
 * Compares two runs over the questions both of them scored, since a comparison is
 * only fair question by question. `a` and `b` name the sides in the report.
 */
export function compareScores(
  a: { name: string; questions: readonly EvalQuestionScore[] },
  b: { name: string; questions: readonly EvalQuestionScore[] },
): EvalComparison {
  const byId = new Map(b.questions.map((score) => [score.id, score]))
  const pairs = a.questions.flatMap((score): Pair[] => {
    const other = byId.get(score.id)
    return other === undefined ? [] : [{ a: score, b: other }]
  })
  const tags = tagsOf(pairs.map((pair) => pair.a))
  return {
    a: a.name,
    b: b.name,
    scopes: [
      scopeComparison('overall', pairs),
      ...tags.map((tag) =>
        scopeComparison(
          tag,
          pairs.filter((pair) => pair.a.tags.includes(tag)),
        ),
      ),
    ],
  }
}
