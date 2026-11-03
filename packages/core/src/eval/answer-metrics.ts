// Answer metrics per row and tag, and how rows compare (SPEC section 10, ADR-0012). These
// are computed from the stored answers and verdicts, with no call to anything.
import {
  ANSWER_COMPARED_METRICS,
  type AnchorCandidate,
  type AnswerComparedMetric,
  type AnswerComparison,
  type AnswerDifference,
  type AnswerMetrics,
  type AnswerRow,
  type AnswerRowResult,
  type AnswerScopeComparison,
  type EvalAnswer,
  type EvalSupport,
  type EvalVerdict,
  type RefusalMetrics,
} from '@docs-rag-lab/contracts'

import { signTest, verdictOf } from './compare.ts'
import type { GoldenQuestion } from './golden.ts'
import { isUnanswerable } from './judge.ts'
import { roundMean } from './metrics.ts'

/** One answer with what was said about it. */
interface Graded {
  answer: EvalAnswer
  verdict: EvalVerdict | undefined
  support: EvalSupport | undefined
}

const keyOf = (item: Pick<EvalAnswer, 'questionId' | 'row' | 'sample'>): string =>
  `${item.questionId}/${String(item.row)}/${String(item.sample)}`

function gradedOf(
  answers: readonly EvalAnswer[],
  verdicts: readonly EvalVerdict[],
  support: readonly EvalSupport[],
): Graded[] {
  const firstVerdicts = new Map(
    verdicts
      .filter((verdict) => verdict.judgeSample === 1 && verdict.status === 'ok')
      .map((verdict) => [keyOf(verdict), verdict]),
  )
  const supports = new Map(
    support.filter((item) => item.status === 'ok').map((item) => [keyOf(item), item]),
  )
  return answers.map((answer) => ({
    answer,
    verdict: firstVerdicts.get(keyOf(answer)),
    support: supports.get(keyOf(answer)),
  }))
}

const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0)
const meanOf = (values: readonly number[]): number =>
  values.length === 0 ? 0 : roundMean(sum(values) / values.length)

/** Whether an answer cites a chunk of one of its question's anchors. */
function citesAnchor(answer: EvalAnswer, anchorChunks: ReadonlySet<string>): boolean {
  return answer.claims.some((claim) =>
    claim.citations.some((citation) => anchorChunks.has(citation.chunkId)),
  )
}

export type AnchorChunksOf = (question: GoldenQuestion) => ReadonlySet<string>

/** Exploratory (ADR-0012): right, with every cited claim supported, and citing an anchor. */
function isCorrectAndGrounded(
  { answer, verdict, support }: Graded,
  anchorChunks: ReadonlySet<string>,
): boolean {
  const claims = support?.claims ?? []
  return (
    verdict?.correctness === 2 &&
    claims.length > 0 &&
    claims.every((claim) => claim.supported) &&
    citesAnchor(answer, anchorChunks)
  )
}

function metricsOf(items: readonly Graded[], anchorChunks: (id: string) => ReadonlySet<string>) {
  const judged = items.filter(({ verdict }) => verdict?.correctness != null)
  const scores: [number, number, number] = [0, 0, 0]
  for (const { verdict } of judged) {
    if (verdict?.correctness != null) scores[verdict.correctness]++
  }
  const cited = items.filter(({ answer }) => answer.claims.length > 0)
  const claims = items.flatMap(({ support }) => support?.claims ?? [])
  const answers = items.map(({ answer }) => answer)
  const metrics: AnswerMetrics = {
    questions: judged.length,
    correctness: meanOf(judged.map(({ verdict }) => verdict?.correctness ?? 0)),
    scores,
    falseRefusals: judged.filter(({ verdict }) => verdict?.falseRefusal === true).length,
    citationAccuracy: {
      cited: cited.length,
      hit: cited.filter(({ answer }) => citesAnchor(answer, anchorChunks(answer.questionId)))
        .length,
    },
    support: { claims: claims.length, supported: claims.filter((c) => c.supported).length },
    correctAndGrounded: judged.filter((item) =>
      isCorrectAndGrounded(item, anchorChunks(item.answer.questionId)),
    ).length,
    meanLatencyMs: meanOf(answers.map((answer) => answer.latencyMs)),
    meanInputTokens: meanOf(answers.map((answer) => answer.inputTokens)),
    meanOutputTokens: meanOf(answers.map((answer) => answer.outputTokens)),
    meanCostUsd: meanOf(answers.map((answer) => answer.costUsd)),
  }
  return metrics
}

export interface AnswerResultsOptions {
  questions: readonly GoldenQuestion[]
  answers: readonly EvalAnswer[]
  verdicts: readonly EvalVerdict[]
  support: readonly EvalSupport[]
  /** The chunks a question's primary and acceptable anchors resolved to. */
  anchorChunks: (questionId: string) => ReadonlySet<string>
}

const rowLabel = (row: AnswerRow, sample: number): string =>
  `row ${String(row)}${sample > 1 ? ` again` : ''}`

/** One row of the ladder, or a second sample of one. */
export function rowResult(
  row: AnswerRow,
  sample: number,
  options: AnswerResultsOptions,
): AnswerRowResult {
  const questions = new Map(options.questions.map((question) => [question.id, question]))
  const all = gradedOf(options.answers, options.verdicts, options.support).filter(
    ({ answer }) => answer.row === row && answer.sample === sample,
  )
  const finished = all.filter(({ answer }) => answer.status === 'ok')
  const unanswerable = (item: Graded): boolean => {
    const question = questions.get(item.answer.questionId)
    return question !== undefined && isUnanswerable(question)
  }
  const answerable = finished.filter((item) => !unanswerable(item))
  const tags = [
    ...new Set(answerable.flatMap(({ answer }) => questions.get(answer.questionId)?.tags ?? [])),
  ].sort()
  const outcomes = finished.filter(unanswerable).map(({ verdict }) => verdict?.outcome)
  const refusals: RefusalMetrics = {
    questions: outcomes.filter((outcome) => outcome != null).length,
    correct: outcomes.filter((outcome) => outcome === 'correct-refusal').length,
    hallucinations: outcomes.filter((outcome) => outcome === 'hallucination').length,
    wrong: outcomes.filter((outcome) => outcome === 'wrong').length,
  }
  const idsWith = (status: EvalAnswer['status']): string[] =>
    all.filter(({ answer }) => answer.status === status).map(({ answer }) => answer.questionId)
  // A failed verdict or support check leaves the means, so it must show up somewhere.
  const unjudged = finished
    .filter((item) => {
      const needsSupport = item.answer.claims.length > 0 && !unanswerable(item)
      return item.verdict === undefined || (needsSupport && item.support === undefined)
    })
    .map(({ answer }) => answer.questionId)
    .sort()
  return {
    row,
    sample,
    overall: metricsOf(answerable, options.anchorChunks),
    byTag: Object.fromEntries(
      tags.map((tag) => [
        tag,
        metricsOf(
          answerable.filter(({ answer }) => questions.get(answer.questionId)?.tags.includes(tag)),
          options.anchorChunks,
        ),
      ]),
    ),
    refusals,
    excluded: {
      truncated: idsWith('truncated').sort(),
      refused: idsWith('refused').sort(),
      failed: idsWith('failed').sort(),
      unjudged,
    },
  }
}

/** What one question scored on one metric, or undefined when it has no such score. */
function valueOf(
  item: Graded,
  metric: AnswerComparedMetric,
  anchorChunks: (id: string) => ReadonlySet<string>,
): number | undefined {
  if (metric === 'correctness') return item.verdict?.correctness ?? undefined
  if (metric === 'correct-and-grounded') {
    // An answer with no citations scores 0 here. Row 0 has no retrieval to ground it.
    if (item.answer.row === 0 || item.verdict?.correctness == null) return undefined
    return isCorrectAndGrounded(item, anchorChunks(item.answer.questionId)) ? 1 : 0
  }
  if (item.answer.claims.length === 0) return undefined
  if (metric === 'citation-accuracy') {
    return citesAnchor(item.answer, anchorChunks(item.answer.questionId)) ? 1 : 0
  }
  const claims = item.support?.claims
  if (claims === undefined || claims.length === 0) return undefined
  return claims.filter((claim) => claim.supported).length / claims.length
}

function difference(
  metric: AnswerComparedMetric,
  pairs: readonly { a: Graded; b: Graded }[],
  anchorChunks: (id: string) => ReadonlySet<string>,
): AnswerDifference | undefined {
  const values = pairs.flatMap(({ a, b }) => {
    const valueA = valueOf(a, metric, anchorChunks)
    const valueB = valueOf(b, metric, anchorChunks)
    return valueA === undefined || valueB === undefined ? [] : [[valueA, valueB] as const]
  })
  if (values.length === 0) return undefined
  const aBetter = values.filter(([a, b]) => a > b).length
  const bBetter = values.filter(([a, b]) => b > a).length
  const p = signTest(aBetter, bBetter)
  const a = meanOf(values.map(([value]) => value))
  const b = meanOf(values.map(([, value]) => value))
  return {
    metric,
    a,
    b,
    aBetter,
    bBetter,
    tied: values.length - aBetter - bBetter,
    p,
    verdict: verdictOf({ questions: values.length, aBetter, bBetter, p, a, b }),
  }
}

/** Two rows question by question, overall and per tag, over the questions both of them scored. */
export function compareRows(
  a: { row: AnswerRow; sample: number },
  b: { row: AnswerRow; sample: number },
  options: AnswerResultsOptions,
): AnswerComparison {
  const questions = new Map(options.questions.map((question) => [question.id, question]))
  const graded = gradedOf(options.answers, options.verdicts, options.support)
  const side = ({ row, sample }: { row: AnswerRow; sample: number }): Map<string, Graded> =>
    new Map(
      graded
        .filter(
          ({ answer }) => answer.row === row && answer.sample === sample && answer.status === 'ok',
        )
        .map((item) => [item.answer.questionId, item]),
    )
  const others = side(b)
  const pairs = [...side(a).values()].flatMap((item) => {
    const other = others.get(item.answer.questionId)
    const question = questions.get(item.answer.questionId)
    return other === undefined || question === undefined || isUnanswerable(question)
      ? []
      : [{ a: item, b: other, tags: question.tags }]
  })
  const scope = (name: string, inScope: typeof pairs): AnswerScopeComparison => ({
    scope: name,
    questions: inScope.length,
    differences: ANSWER_COMPARED_METRICS.flatMap((metric) => {
      const found = difference(metric, inScope, options.anchorChunks)
      return found === undefined ? [] : [found]
    }),
  })
  const tags = [...new Set(pairs.flatMap(({ tags: names }) => names))].sort()
  return {
    a: rowLabel(a.row, a.sample),
    b: rowLabel(b.row, b.sample),
    scopes: [
      scope('overall', pairs),
      ...tags.map((tag) =>
        scope(
          tag,
          pairs.filter(({ tags: names }) => names.includes(tag)),
        ),
      ),
    ],
  }
}

/** How often the judge's second opinion on row 3's first answers matches its first. */
export function judgeRetest(
  verdicts: readonly EvalVerdict[],
): { compared: number; agreed: number } | null {
  const second = verdicts.filter((verdict) => verdict.judgeSample === 2 && verdict.status === 'ok')
  if (second.length === 0) return null
  const first = new Map(
    verdicts
      .filter((verdict) => verdict.judgeSample === 1 && verdict.status === 'ok')
      .map((verdict) => [keyOf(verdict), verdict]),
  )
  const pairs = second.flatMap((verdict) => {
    const other = first.get(keyOf(verdict))
    return other === undefined ? [] : [[verdict, other] as const]
  })
  return {
    compared: pairs.length,
    agreed: pairs.filter(([x, y]) => x.correctness === y.correctness && x.outcome === y.outcome)
      .length,
  }
}

/**
 * The owner's rule for growing the anchors: a cited chunk that supports a correct answer but
 * is not an anchor is listed for review, and is never added automatically.
 */
export function anchorCandidates(
  options: AnswerResultsOptions,
  docPathOf: (chunkId: string) => string,
): AnchorCandidate[] {
  const found = new Map<string, AnchorCandidate>()
  for (const { answer, verdict, support } of gradedOf(
    options.answers,
    options.verdicts,
    options.support,
  )) {
    if (verdict?.correctness !== 2 || support === undefined) continue
    answer.claims.forEach((claim, i) => {
      if (support.claims[i]?.supported !== true) return
      for (const { chunkId } of claim.citations) {
        if (options.anchorChunks(answer.questionId).has(chunkId)) continue
        const key = `${answer.questionId}/${chunkId}`
        const known = found.get(key)
        // One row per question and chunk: the lowest row that cited it.
        if (known === undefined || answer.row < known.row) {
          found.set(key, {
            questionId: answer.questionId,
            row: answer.row,
            chunkId,
            docPath: docPathOf(chunkId),
          })
        }
      }
    })
  }
  return [...found.values()].sort(
    (a, b) => a.questionId.localeCompare(b.questionId) || a.chunkId.localeCompare(b.chunkId),
  )
}
