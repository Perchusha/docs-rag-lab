import type {
  AnswerComparison,
  AnswerRow,
  EvalAnswer,
  EvalReport,
  EvalVerdict,
} from '@docs-rag-lab/contracts'
import { describe, expect, it } from 'vitest'

import { PoolError, poolReports } from './pool.ts'

interface Row {
  /** Scores of the first answers, by question; null means the answer did not finish. */
  first: (0 | 1 | 2 | null)[]
  /** Scores of the second answers, if the row answered twice. */
  second?: (0 | 1 | 2 | null)[]
}

const id = (source: string, i: number): string => `${source}-${String(i + 1).padStart(4, '0')}`

function graded(source: string, row: AnswerRow, sample: number, scores: (0 | 1 | 2 | null)[]) {
  const answers: EvalAnswer[] = scores.map((score, i) => ({
    questionId: id(source, i),
    row,
    sample,
    status: score === null ? 'failed' : 'ok',
    model: 'm',
    stopReason: 'end_turn',
    text: '',
    blocks: [],
    claims: [],
    context: [],
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    latencyMs: 0,
    firstTokenMs: null,
    fromCache: true,
  }))
  const verdicts: EvalVerdict[] = scores.flatMap((score, i) =>
    score === null
      ? []
      : [
          {
            questionId: id(source, i),
            row,
            sample,
            judgeSample: 1,
            status: 'ok' as const,
            reasoning: '',
            correctness: score,
            falseRefusal: false,
            outcome: null,
            costUsd: 0,
          },
        ],
  )
  return { answers, verdicts }
}

/** The guards' comparison of row 3 with row 6, as a report stores it: [aBetter, bBetter, tied]. */
function stored(
  hold: [number, number, number],
  refused: [number, number, number],
): AnswerComparison {
  const difference = (metric: 'citations-hold' | 'not-wrongly-refused', split: number[]) => {
    const [aBetter = 0, bBetter = 0, tied = 0] = split
    // Means as if every tie held on both sides.
    const n = aBetter + bBetter + tied
    const a = (aBetter + tied) / n
    const b = (bBetter + tied) / n
    return { metric, a, b, aBetter, bBetter, tied, p: 1, verdict: 'noise' as const }
  }
  return {
    a: 'row 3',
    b: 'row 6',
    scopes: [
      {
        scope: 'overall',
        questions: hold[0] + hold[1] + hold[2],
        differences: [
          difference('citations-hold', hold),
          difference('not-wrongly-refused', refused),
        ],
      },
    ],
  }
}

function report(
  source: string,
  row3: Row,
  row6: Row,
  options: {
    comparisons?: AnswerComparison[]
    unanswerable?: number
    hallucinated?: boolean
  } = {},
): EvalReport {
  const parts = [
    graded(source, 3, 1, row3.first),
    graded(source, 6, 1, row6.first),
    ...(row3.second === undefined ? [] : [graded(source, 3, 2, row3.second)]),
    ...(row6.second === undefined ? [] : [graded(source, 6, 2, row6.second)]),
  ]
  const unanswerable = Array.from({ length: options.unanswerable ?? 0 }, (_, i) =>
    id(`${source}-u`, i),
  )
  const refusals = unanswerable.flatMap((question) =>
    ([3, 6] as const).map((row): EvalVerdict => ({
      questionId: question,
      row,
      sample: 1,
      judgeSample: 1,
      status: 'ok',
      reasoning: '',
      correctness: null,
      falseRefusal: null,
      outcome: row === 6 && options.hallucinated === true ? 'hallucination' : 'correct-refusal',
      costUsd: 0,
    })),
  )
  const tied = row3.first.length
  const guards = [stored([0, 0, tied], [0, 0, tied])]
  return {
    identity: { sourceId: source, goldenSet: { version: 1, hash: 'h' } },
    result: { unanswerable },
    run: { name: 'm9', repoSha: 'sha', createdAt: '2026-11-10' },
    answers: {
      answers: [
        ...parts.flatMap((part) => part.answers),
        ...graded(
          `${source}-u`,
          6,
          1,
          unanswerable.map(() => 0),
        ).answers,
      ],
      verdicts: [...parts.flatMap((part) => part.verdicts), ...refusals],
      support: [],
      comparisons: options.comparisons ?? guards,
    },
  } as unknown as EvalReport
}

describe('poolReports', () => {
  it('adds the questions of every report, and counts an answer that did not finish as not right', () => {
    const ts = report('ts', { first: [1, 1, 1, 2, 2] }, { first: [2, 2, 2, 2, null] })
    const react = report('react', { first: [1, 1, 0, 2] }, { first: [2, 2, 2, 2] })

    const pooled = poolReports([ts, react], 3, 6)

    const fully = pooled.metrics.find(({ metric }) => metric === 'fully-correct')
    expect(fully).toMatchObject({
      questions: 9,
      aBetter: 1,
      bBetter: 6,
      tied: 2,
      runToRun: { a: null, b: null },
      verdict: 'not-significant',
    })
    expect(pooled.notOk).toEqual([
      { sourceId: 'ts', questionId: 'ts-0005', row: 6, status: 'failed' },
    ])
    expect(pooled.holds).toBe(false)
    expect(pooled.reports.map(({ sourceId }) => sourceId)).toEqual(['ts', 'react'])
  })

  it('holds when fully correct names row 6 past twice the run to run, and no guard names row 3', () => {
    const ts = report(
      'ts',
      { first: [1, 1, 1, 2, 2, 2], second: [1, 1, 1, 2, 2, 1] },
      { first: [2, 2, 2, 2, 2, 2], second: [2, 2, 2, 2, 2, 2] },
    )
    const react = report(
      'react',
      { first: [1, 1, 1, 2], second: [1, 1, 1, 2] },
      { first: [2, 2, 2, 2], second: [2, 2, 2, 2] },
    )

    const pooled = poolReports([ts, react], 3, 6)

    expect(pooled.metrics[0]).toMatchObject({
      metric: 'fully-correct',
      aBetter: 0,
      bBetter: 6,
      runToRun: { a: 1, b: 0 },
      verdict: 'b',
    })
    expect(pooled.holds).toBe(true)
  })

  it('reads a margin within twice the larger run to run as noise', () => {
    const ts = report(
      'ts',
      { first: [1, 1, 1, 1, 1, 1, 2] },
      { first: [2, 2, 2, 2, 2, 2, 2], second: [1, 1, 1, 2, 2, 2, 2] },
    )

    const pooled = poolReports([ts], 3, 6)

    expect(pooled.metrics[0]).toMatchObject({ bBetter: 6, runToRun: { a: null, b: 3 } })
    expect(pooled.metrics[0]?.verdict).toBe('noise')
    expect(pooled.holds).toBe(false)
  })

  it('does not hold when a guard names row 3, and names every hallucination', () => {
    const guards = [stored([8, 0, 2], [0, 0, 10])]
    const ts = report(
      'ts',
      { first: [1, 1, 1, 1, 1, 1, 2, 2, 2, 2] },
      { first: [2, 2, 2, 2, 2, 2, 2, 2, 2, 2] },
      { comparisons: guards, unanswerable: 1, hallucinated: true },
    )

    const pooled = poolReports([ts], 3, 6)

    expect(pooled.metrics.map(({ metric, verdict }) => [metric, verdict])).toEqual([
      ['fully-correct', 'b'],
      ['citations-hold', 'a'],
      ['not-wrongly-refused', 'noise'],
    ])
    expect(pooled.metrics[0]?.questions).toBe(10)
    expect(pooled.hallucinations).toEqual([{ sourceId: 'ts', questionId: 'ts-u-0001' }])
    expect(pooled.holds).toBe(false)
  })

  it('refuses a report without the rows or the comparisons the test reads', () => {
    const ts = report('ts', { first: [2] }, { first: [2] })
    const none = { ...ts, answers: undefined } as EvalReport

    expect(() => poolReports([none], 3, 6)).toThrow(PoolError)
    expect(() => poolReports([ts], 3, 5)).toThrow('has no row 5')
    expect(() =>
      poolReports([report('ts', { first: [2] }, { first: [2] }, { comparisons: [] })], 3, 6),
    ).toThrow('compares no row 3 with row 6')
  })
})
