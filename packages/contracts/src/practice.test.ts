import { describe, expect, it } from 'vitest'

import { MAX_FLAG_REASON, parseFlagRequest, parseReviewRequest, RATINGS } from './practice.ts'

describe('parseReviewRequest (ADR-0018)', () => {
  it('takes a question ID and one of the four ratings', () => {
    expect(RATINGS).toEqual(['again', 'hard', 'good', 'easy'])
    expect(parseReviewRequest({ questionId: 'q1', rating: 'good' })).toEqual({
      questionId: 'q1',
      rating: 'good',
    })
  })

  it('refuses anything else', () => {
    for (const value of [
      null,
      'good',
      {},
      { questionId: '', rating: 'good' },
      { questionId: 'q1', rating: 'great' },
      { questionId: 1, rating: 'good' },
    ]) {
      expect(parseReviewRequest(value)).toBeUndefined()
    }
  })
})

describe('parseFlagRequest (ADR-0018)', () => {
  it('takes a question ID and a reason, trimmed', () => {
    expect(parseFlagRequest({ questionId: 'q1', reason: '  It says set once.\n' })).toEqual({
      questionId: 'q1',
      reason: 'It says set once.',
    })
  })

  it('refuses no reason, a blank one, one too long, or anything else', () => {
    for (const value of [
      null,
      { questionId: 'q1' },
      { questionId: 'q1', reason: '   ' },
      { questionId: 'q1', reason: 'x'.repeat(MAX_FLAG_REASON + 1) },
      { questionId: '', reason: 'Wrong.' },
      { questionId: 'q1', reason: 3 },
    ]) {
      expect(parseFlagRequest(value)).toBeUndefined()
    }
  })
})
