import { TRACE_VERSION, type RetrievalTrace, type TraceRerank } from '@docs-rag-lab/contracts'
import { describe, expect, it } from 'vitest'

import { rerankRows, rerankSource, rerankSummary } from './rerank.ts'

function traceWith(ranked: [rank: number, fusedRank: number][], rerank: Partial<TraceRerank> = {}) {
  const trace: RetrievalTrace = {
    version: TRACE_VERSION,
    question: 'q',
    sourceId: 's',
    strategy: 'rerank',
    params: { topK: 2, candidates: 50, rrfK: 60 },
    filters: { docTypes: [] },
    query: { terms: [], exactTokens: [] },
    embedding: { provider: 'fake', from: 'cache', ms: 0 },
    lists: [],
    fusion: { method: 'none' },
    rerank: {
      provider: 'voyage:rerank-3',
      depth: 20,
      from: 'cache',
      rateLimitRetries: 0,
      ms: 1,
      ranked: ranked.map(([rank, fusedRank]) => ({
        chunkId: `c${String(fusedRank)}`,
        rank,
        fusedRank,
        score: 1 / rank,
      })),
      ...rerank,
    },
    chunks: {},
    context: [],
    totalMs: 1,
  }
  return trace
}

describe('rerankRows', () => {
  it('marks what crosses the line, and nothing else', () => {
    const rows = rerankRows(
      traceWith([
        [1, 3],
        [2, 1],
        [3, 2],
        [4, 4],
      ]),
    )

    expect(rows.map(({ rank, was, change }) => [rank, was, change])).toEqual([
      [1, 3, 'came in'],
      [2, 1, undefined],
      [3, 2, 'left'],
      [4, 4, undefined],
    ])
  })

  it('is empty for a trace with no rerank', () => {
    const trace = traceWith([])
    delete trace.rerank
    expect(rerankRows(trace)).toEqual([])
  })
})

describe('rerankSummary', () => {
  const summaryOf = (ranked: [number, number][]) => rerankSummary(rerankRows(traceWith(ranked)), 2)

  it('says how many come in and leave', () => {
    expect(
      summaryOf([
        [1, 3],
        [2, 4],
        [3, 1],
        [4, 2],
      ]),
    ).toBe('2 chunks would come into the top 2, and 2 would leave.')
  })

  it('says one chunk in the singular', () => {
    expect(
      summaryOf([
        [1, 3],
        [2, 1],
        [3, 2],
      ]),
    ).toBe('1 chunk would come into the top 2, and 1 would leave.')
  })

  it('says when the same chunks stay, and whether their order changed', () => {
    expect(
      summaryOf([
        [1, 2],
        [2, 1],
        [3, 3],
      ]),
    ).toBe('The same chunks would stay in the top 2, in another order.')
    expect(
      summaryOf([
        [1, 1],
        [2, 2],
        [3, 4],
        [4, 3],
      ]),
    ).toBe('The same chunks would stay in the top 2, in the same order.')
  })
})

describe('rerankSource', () => {
  it('says the cache, or how long the call took', () => {
    expect(rerankSource(traceWith([[1, 1]]), '2 s')).toBe(
      'voyage:rerank-3 scored the fused top 1 in one call, from the cache.',
    )
    expect(rerankSource(traceWith([[1, 1]], { from: 'api' }), '2 s')).toBe(
      'voyage:rerank-3 scored the fused top 1 in one call, in 2 s.',
    )
  })

  it('says so when the call waited out a rate limit', () => {
    expect(
      rerankSource(traceWith([[1, 1]], { from: 'api', rateLimitRetries: 1 }), '2 s'),
    ).toContain('after waiting out a rate limit')
  })
})
