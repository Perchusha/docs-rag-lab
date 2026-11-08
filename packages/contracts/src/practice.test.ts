import { describe, expect, it } from 'vitest'

import { parseReviewRequest, RATINGS } from './practice.ts'

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
