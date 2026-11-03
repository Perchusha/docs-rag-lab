import type { EvalQuestionScore, RetrievalTrace } from '@docs-rag-lab/contracts'
import { describe, expect, it } from 'vitest'

import { parseGoldenSet, type AnchorRef, type GoldenQuestion } from './golden.ts'
import { bestRank, metricsOf, rankingOf, scoreQuestion, strategyResult } from './metrics.ts'

function question(fields: Record<string, unknown>): GoldenQuestion {
  const row = { id: 'ts-0001', question: 'Q?', answer: 'A.', tags: ['basic'], ...fields }
  const [parsed] = parseGoldenSet(JSON.stringify(row))
  if (parsed === undefined) throw new Error('no question')
  return parsed
}

/** Each anchor's path is the chunk it resolves to; a comma gives it several. */
const chunksOf = (anchor: AnchorRef): string[] => anchor.at.split(',')

const ranking = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']
const score = (fields: Record<string, unknown>) =>
  scoreQuestion(question(fields), ranking, ranking.slice(0, 8), chunksOf)

/** A score with only the ranks set. */
function ranked(
  primaryRank: number | null,
  acceptableRank: number | null = primaryRank,
  recallAt8 = primaryRank !== null && primaryRank <= 8 ? 1 : 0,
  tags = ['basic'],
): EvalQuestionScore {
  return { id: 'q', tags, anchors: [], primaryRank, acceptableRank, recallAt8, context: [] }
}

describe('bestRank', () => {
  it('is 1-based, takes the best chunk, and is null when none is ranked', () => {
    expect(bestRank(['a'], ranking)).toBe(1)
    expect(bestRank(['c', 'b'], ranking)).toBe(2)
    expect(bestRank(['x', 'j'], ranking)).toBe(10)
    expect(bestRank(['x'], ranking)).toBeNull()
    expect(bestRank([], ranking)).toBeNull()
  })
})

describe('rankingOf', () => {
  const list = { name: 'vector', scoring: 'cosine-distance', ms: 0 } as const
  const candidates = [{ chunkId: 'v1', rank: 1, score: 0.1 }]

  it('uses the fused ranking under hybrid, not the vector list', () => {
    const trace = {
      lists: [{ ...list, candidates }],
      fusion: {
        method: 'rrf',
        k: 60,
        ms: 0,
        ranked: [{ chunkId: 'f1', rank: 1, score: 1, ranks: {} }],
      },
    } as unknown as RetrievalTrace

    expect(rankingOf(trace)).toEqual(['f1'])
  })

  it('uses the vector list without fusion', () => {
    const trace = {
      lists: [{ ...list, candidates }],
      fusion: { method: 'none' },
    } as unknown as RetrievalTrace

    expect(rankingOf(trace)).toEqual(['v1'])
  })
})

describe('scoreQuestion', () => {
  it('reports the rank of each anchor, the best primary and the best overall', () => {
    expect(score({ primary: ['c', 'b'], acceptable: ['a'] })).toMatchObject({
      anchors: [
        { anchor: 'c', role: 'primary', rank: 3 },
        { anchor: 'b', role: 'primary', rank: 2 },
        { anchor: 'a', role: 'acceptable', rank: 1 },
      ],
      primaryRank: 2,
      acceptableRank: 1,
    })
  })

  it('takes the best of the chunks an anchor resolves to', () => {
    expect(score({ primary: ['j,c'] }).primaryRank).toBe(3)
  })

  it('does not let an acceptable anchor change the primary rank or recall', () => {
    expect(score({ primary: ['x'], acceptable: ['a'] })).toMatchObject({
      primaryRank: null,
      acceptableRank: 1,
      recallAt8: 0,
    })
  })

  describe('recall@8', () => {
    it('counts each primary anchor under all, the default', () => {
      expect(score({ primary: ['a', 'b', 'x'] }).recallAt8).toBeCloseTo(2 / 3, 5)
      expect(score({ primary: ['a', 'b'] }).recallAt8).toBe(1)
    })

    it('needs one primary anchor under any', () => {
      expect(score({ primary: ['a', 'x'], primaryMatch: 'any' }).recallAt8).toBe(1)
      expect(score({ primary: ['x', 'y'], primaryMatch: 'any' }).recallAt8).toBe(0)
    })

    it('stops at rank 8, the context', () => {
      expect(score({ primary: ['h'] }).recallAt8).toBe(1)
      expect(score({ primary: ['i'] }).recallAt8).toBe(0)
    })
  })

  it('keeps the context as given, and sorts the tags', () => {
    const scored = score({ primary: ['a'], tags: ['version', 'basic'] })

    expect(scored.context).toEqual(ranking.slice(0, 8))
    expect(scored.tags).toEqual(['basic', 'version'])
  })
})

describe('metricsOf', () => {
  it('counts hits at each cutoff, inclusive', () => {
    const { primary } = metricsOf([1, 3, 4, 5, 8, 9, null].map((rank) => ranked(rank)))

    expect(primary.hits).toEqual({ 1: 1, 3: 2, 5: 4, 8: 5 })
  })

  it('averages reciprocal ranks, with a missing anchor as 0', () => {
    const { primary } = metricsOf([ranked(1), ranked(2), ranked(4), ranked(null)])

    expect(primary.mrr).toBe(0.4375)
  })

  it('reports acceptable anchors apart from primary ones', () => {
    const metrics = metricsOf([ranked(null, 1), ranked(4, 2)])

    expect(metrics.primary).toEqual({ hits: { 1: 0, 3: 0, 5: 1, 8: 1 }, mrr: 0.125 })
    expect(metrics.withAcceptable).toEqual({ hits: { 1: 1, 3: 2, 5: 2, 8: 2 }, mrr: 0.75 })
  })

  it('averages recall over questions', () => {
    expect(metricsOf([ranked(1, 1, 1), ranked(1, 1, 0.5)]).recallAt8).toBe(0.75)
  })

  it('rounds means, so a report reads the same everywhere', () => {
    expect(metricsOf([ranked(3), ranked(3), ranked(null)]).primary.mrr).toBe(0.222222)
  })

  it('counts zero for no questions, not NaN', () => {
    expect(metricsOf([])).toEqual({
      questions: 0,
      primary: { hits: { 1: 0, 3: 0, 5: 0, 8: 0 }, mrr: 0 },
      recallAt8: 0,
      withAcceptable: { hits: { 1: 0, 3: 0, 5: 0, 8: 0 }, mrr: 0 },
    })
  })
})

describe('strategyResult', () => {
  it('reports each tag on its own, sorted, and orders questions by ID', () => {
    const b = { ...ranked(1, 1, 1, ['fresh', 'basic']), id: 'ts-0002' }
    const a = { ...ranked(2, 2, 1, ['basic']), id: 'ts-0001' }

    const result = strategyResult('hybrid', [b, a])

    expect(result.overall.questions).toBe(2)
    expect(Object.keys(result.byTag)).toEqual(['basic', 'fresh'])
    expect(result.byTag.basic?.questions).toBe(2)
    expect(result.byTag.fresh?.primary.hits[1]).toBe(1)
    expect(result.questions.map((q) => q.id)).toEqual(['ts-0001', 'ts-0002'])
  })
})
