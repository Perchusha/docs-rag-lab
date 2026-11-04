import type { BatchingCheck } from '@docs-rag-lab/core'
import { describe, expect, it } from 'vitest'

import { formatBatchingCheck } from './eval-rerank.ts'

const check = (differing: number): BatchingCheck => ({
  compared: 23,
  differing,
  passed: differing === 0,
  questions: [
    {
      id: 'ts-0001',
      documents: 20,
      scores: [0.75, 0.125],
      tokens: 8_412,
      compositions: [
        {
          name: 'halves',
          calls: 2,
          compared: 20,
          differing,
          largestDifference: differing === 0 ? 0 : 0.00001,
          orderChanged: differing > 0,
        },
        {
          name: 'alone',
          calls: 1,
          compared: 3,
          differing: 0,
          largestDifference: 0,
          orderChanged: false,
        },
      ],
    },
  ],
})

describe('formatBatchingCheck', () => {
  it('says every score matched, and how fine the scores are', () => {
    const text = formatBatchingCheck(check(0), 'rerank-test')
    expect(text).toContain('ts-0001: 20 documents, 8,412 billed tokens in one call')
    expect(text).toContain('scores with up to 3 decimals')
    expect(text).toContain('halves   2 calls  20 compared, 0 differ')
    expect(text).toContain('alone    1 call   3 compared, 0 differ')
    expect(text).toContain('All 23 scores match exactly')
  })

  it('says how many differ, by how much, and whether the order moved', () => {
    const text = formatBatchingCheck(check(2), 'rerank-test')
    expect(text).toContain('2 differ, by at most 0.00001, order changed')
    expect(text).toContain('2 of 23 scores differ.')
    expect(text).not.toContain('match exactly')
  })
})
