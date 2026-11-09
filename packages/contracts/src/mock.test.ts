import { describe, expect, it } from 'vitest'

import { MAX_MOCK_ANSWER, parseMockAnswerRequest, parseMockStartRequest } from './mock.ts'

describe('parseMockStartRequest (ADR-0018)', () => {
  it('takes the chosen technologies', () => {
    expect(parseMockStartRequest({ sources: ['typescript', 'react'] })).toEqual({
      sources: ['typescript', 'react'],
    })
  })

  it('refuses none, or anything else', () => {
    for (const value of [null, [], {}, { sources: [] }, { sources: [''] }, { sources: 'react' }]) {
      expect(parseMockStartRequest(value)).toBeUndefined()
    }
  })
})

describe('parseMockAnswerRequest', () => {
  const answer = { sessionId: 's1', questionId: 'q1', step: 'question', answer: '  It narrows.  ' }

  it('takes an answer to a question or its follow-up, trimmed, and an empty one skips', () => {
    expect(parseMockAnswerRequest(answer)).toEqual({ ...answer, answer: 'It narrows.' })
    expect(parseMockAnswerRequest({ ...answer, step: 'follow-up', answer: ' ' })).toEqual({
      ...answer,
      step: 'follow-up',
      answer: '',
    })
  })

  it('refuses an unknown step, an answer too long, or a missing field', () => {
    for (const value of [
      null,
      { ...answer, step: 'third' },
      { ...answer, answer: 'x'.repeat(MAX_MOCK_ANSWER + 1) },
      { ...answer, sessionId: '' },
      { ...answer, questionId: 3 },
      { sessionId: 's1', questionId: 'q1', step: 'question' },
    ]) {
      expect(parseMockAnswerRequest(value)).toBeUndefined()
    }
  })
})
