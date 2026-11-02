import { describe, expect, it } from 'vitest'

import { MAX_QUESTION_LENGTH, parseRetrievalRequest } from './requests.ts'

describe('parseRetrievalRequest', () => {
  it('accepts a question alone, and every optional field', () => {
    expect(parseRetrievalRequest({ question: 'What is `satisfies`?' })).toEqual({
      ok: true,
      value: { question: 'What is `satisfies`?' },
    })
    const full = {
      question: 'q',
      source: 'typescript',
      strategy: 'vector',
      docTypes: ['option', 'release-notes'],
      topK: 8,
    }
    expect(parseRetrievalRequest(full)).toEqual({ ok: true, value: full })
  })

  it.each([
    [null, 'the body must be a JSON object'],
    [[], 'the body must be a JSON object'],
    ['q', 'the body must be a JSON object'],
    [{}, 'question must be a non-empty string'],
    [{ question: '  ' }, 'question must be a non-empty string'],
    [{ question: 1 }, 'question must be a non-empty string'],
    [{ question: 'q', source: '' }, 'source must be a string'],
    [{ question: 'q', strategy: 'bm25' }, 'strategy must be one of vector, hybrid'],
    [{ question: 'q', docTypes: 'option' }, 'docTypes must be an array of strings'],
    [{ question: 'q', docTypes: ['option', 1] }, 'docTypes must be an array of strings'],
    [{ question: 'q', topK: '8' }, 'topK must be a whole number'],
    [{ question: 'q', topK: 2.5 }, 'topK must be a whole number'],
    [{ question: 'q', model: 'x', key: 'y' }, 'unknown field "model", "key"'],
  ])('refuses %j: %s', (body, error) => {
    expect(parseRetrievalRequest(body)).toEqual({ ok: false, error })
  })

  it('caps the question length', () => {
    expect(parseRetrievalRequest({ question: 'a'.repeat(MAX_QUESTION_LENGTH) }).ok).toBe(true)
    expect(parseRetrievalRequest({ question: 'a'.repeat(MAX_QUESTION_LENGTH + 1) })).toEqual({
      ok: false,
      error: `question must be at most ${String(MAX_QUESTION_LENGTH)} characters`,
    })
  })

  it('leaves value checks to the engine: an unknown doc type or a large top K pass', () => {
    expect(parseRetrievalRequest({ question: 'q', docTypes: ['nope'], topK: 5000 }).ok).toBe(true)
  })
})
