import type { EvalQuestionScore, MetricDifference } from '@docs-rag-lab/contracts'
import { describe, expect, it } from 'vitest'

import { compareScores, signTest, verdictOf } from './compare.ts'

function score(
  id: string,
  primaryRank: number | null,
  tags = ['basic'],
  acceptableRank = primaryRank,
  recallAt8 = primaryRank !== null && primaryRank <= 8 ? 1 : 0,
): EvalQuestionScore {
  return { id, tags, anchors: [], primaryRank, acceptableRank, recallAt8, context: [] }
}

const ids = (n: number): string[] =>
  Array.from({ length: n }, (_, i) => `ts-${String(i + 1).padStart(4, '0')}`)

function metric(differences: readonly MetricDifference[], name: string): MetricDifference {
  const found = differences.find((difference) => difference.metric === name)
  if (found === undefined) throw new Error(`no ${name}`)
  return found
}

const overall = (a: EvalQuestionScore[], b: EvalQuestionScore[]) => {
  const scope = compareScores({ name: 'A', questions: a }, { name: 'B', questions: b }).scopes[0]
  if (scope === undefined) throw new Error('no scope')
  return scope
}

describe('signTest', () => {
  it.each([
    [0, 0, 1],
    [1, 0, 1],
    [1, 1, 1],
    [5, 0, 0.0625],
    [6, 0, 0.03125],
    [0, 6, 0.03125],
    [14, 7, 0.189246],
    [9, 5, 0.42395],
    [20, 0, 0.000002],
  ])('%i against %i gives p = %f', (a, b, p) => {
    expect(signTest(a, b)).toBeCloseTo(p, 5)
  })
})

describe('verdictOf', () => {
  const verdict = (questions: number, aBetter: number, bBetter: number, p: number, a = 1, b = 0) =>
    verdictOf({ questions, aBetter, bBetter, p, a, b })

  it('calls a side better only beyond both the noise rule and the test', () => {
    expect(verdict(40, 6, 0, 0.03125, 30, 24)).toBe('a')
    expect(verdict(40, 0, 6, 0.03125, 24, 30)).toBe('b')
  })

  it('calls a difference of one or two questions noise, whatever the test says', () => {
    expect(verdict(40, 2, 0, 0.5)).toBe('noise')
    expect(verdict(40, 7, 5, 0.01)).toBe('noise')
    expect(verdict(40, 0, 2, 0.01)).toBe('noise')
  })

  it('calls a larger difference not significant while p >= 0.05', () => {
    expect(verdict(40, 5, 0, 0.0625)).toBe('not-significant')
    expect(verdict(40, 14, 7, 0.189)).toBe('not-significant')
    expect(verdict(40, 3, 0, 0.05)).toBe('not-significant')
  })

  it('calls a scope of 5 or fewer too few, even at a clean sweep', () => {
    expect(verdict(5, 5, 0, 0.0625)).toBe('too-few')
    expect(verdict(4, 0, 0, 1)).toBe('too-few')
    expect(verdict(6, 6, 0, 0.03125)).toBe('a')
  })

  it('names no winner when the wins and the totals disagree', () => {
    expect(verdict(40, 10, 2, 0.0386, 0.756, 0.792)).toBe('mixed')
    expect(verdict(40, 2, 10, 0.0386, 0.792, 0.756)).toBe('mixed')
    expect(verdict(40, 10, 2, 0.0386, 0.75, 0.75)).toBe('mixed')
  })
})

describe('compareScores', () => {
  it('counts who is better per question, not by comparing the totals', () => {
    // Same MRR total in both, won on different questions.
    const result = overall(
      [score('ts-0001', 1), score('ts-0002', 2)],
      [score('ts-0001', 2), score('ts-0002', 1)],
    )

    expect(metric(result.primary, 'mrr')).toMatchObject({
      a: 0.75,
      b: 0.75,
      aBetter: 1,
      bBetter: 1,
      tied: 0,
      p: 1,
    })
  })

  it('reports hit@k as counts, and counts a question for hit@k only across the cutoff', () => {
    const a = [score('ts-0001', 1), score('ts-0002', 3), score('ts-0003', null)]
    const b = [score('ts-0001', 2), score('ts-0002', 4), score('ts-0003', 8)]

    const { primary } = overall(a, b)

    expect(metric(primary, 'hit@1')).toMatchObject({ a: 1, b: 0, aBetter: 1, bBetter: 0, tied: 2 })
    expect(metric(primary, 'hit@3')).toMatchObject({ a: 2, b: 1, aBetter: 1, bBetter: 0, tied: 2 })
    expect(metric(primary, 'hit@8')).toMatchObject({ a: 2, b: 3, aBetter: 0, bBetter: 1, tied: 2 })
    expect(metric(primary, 'mrr')).toMatchObject({ aBetter: 2, bBetter: 1, tied: 0 })
  })

  it('does not call a side better for many small wins against a few large defeats', () => {
    // a wins ten questions by a little (5 against 6) and loses two by a lot (8 against 1).
    const a = ids(12).map((id, i) => score(id, i < 10 ? 5 : 8))
    const b = ids(12).map((id, i) => score(id, i < 10 ? 6 : 1))

    const { primary } = overall(a, b)

    const mrr = metric(primary, 'mrr')
    expect(mrr).toMatchObject({ aBetter: 10, bBetter: 2, verdict: 'mixed' })
    expect(mrr.a).toBeLessThan(mrr.b)
  })

  it('finds a real win when one side wins enough questions', () => {
    const a = ids(10).map((id) => score(id, 1))
    const b = ids(10).map((id, i) => score(id, i < 7 ? 5 : 1))

    const { primary } = overall(a, b)

    expect(metric(primary, 'mrr')).toMatchObject({ aBetter: 7, bBetter: 0, verdict: 'a' })
    expect(metric(primary, 'hit@8')).toMatchObject({ tied: 10, verdict: 'noise' })
  })

  it('compares recall@8 on primary anchors, and only reports it once', () => {
    const a = [score('ts-0001', 1, ['basic'], 1, 1)]
    const b = [score('ts-0001', 1, ['basic'], 1, 0.5)]

    const result = overall(a, b)

    expect(metric(result.primary, 'recall@8')).toMatchObject({ a: 1, b: 0.5, aBetter: 1 })
    expect(result.withAcceptable.map(({ metric: name }) => name)).not.toContain('recall@8')
  })

  it('grades acceptable anchors apart from primary ones', () => {
    const a = [score('ts-0001', 5, ['basic'], 1)]
    const b = [score('ts-0001', 2, ['basic'], 2)]

    const result = overall(a, b)

    expect(metric(result.primary, 'mrr')).toMatchObject({ aBetter: 0, bBetter: 1 })
    expect(metric(result.withAcceptable, 'mrr')).toMatchObject({ aBetter: 1, bBetter: 0 })
  })

  it('compares only the questions both sides scored', () => {
    const a = [score('ts-0001', 1), score('ts-0002', 1)]
    const b = [score('ts-0002', 2), score('ts-0003', 1)]

    const result = overall(a, b)

    expect(result.questions).toBe(1)
    expect(metric(result.primary, 'hit@1')).toMatchObject({ a: 1, b: 0, tied: 0 })
  })

  it('reports overall first, then each tag in order, and marks small tags too few', () => {
    const comparison = compareScores(
      {
        name: 'vector',
        questions: ids(7).map((id, i) => score(id, 1, i < 6 ? ['big'] : ['small'])),
      },
      { name: 'hybrid', questions: ids(7).map((id) => score(id, 5)) },
    )

    expect(comparison).toMatchObject({ a: 'vector', b: 'hybrid' })
    expect(comparison.scopes.map(({ scope, questions }) => [scope, questions])).toEqual([
      ['overall', 7],
      ['big', 6],
      ['small', 1],
    ])
    expect(metric(comparison.scopes[0]?.primary ?? [], 'hit@1').verdict).toBe('a')
    expect(metric(comparison.scopes[1]?.primary ?? [], 'hit@1').verdict).toBe('a')
    expect(metric(comparison.scopes[2]?.primary ?? [], 'hit@1').verdict).toBe('too-few')
  })
})
