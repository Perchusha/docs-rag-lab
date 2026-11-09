import type {
  BankQuestion,
  FlagResult,
  PracticeDeck,
  PracticeOverview,
  ReviewResult,
} from '@docs-rag-lab/contracts'
import { openInterviewState, type LoadedBank } from '@docs-rag-lab/core'
import { describe, expect, it, vi } from 'vitest'

import {
  handleDeck,
  handleFlag,
  handleOverview,
  handleReview,
  MAX_DECK,
  type InterviewBackend,
} from './handlers.ts'

const NOW = new Date('2026-11-08T12:00:00.000Z')

const question = (source: string, id: string, topicId: string): BankQuestion => ({
  id,
  source,
  kind: 'compiler-type',
  topicId,
  prompt: `Question ${id}?`,
  answer: 'Answer.',
  citation: { url: 'u', title: 't', sectionPath: [], docPath: 'p', chunkId: `c-${id}` },
  verifiedBy: 'compiler',
})

const bank: LoadedBank = {
  topics: [
    { source: 'typescript', id: 'narrowing', title: 'Narrowing', group: 'Handbook' },
    { source: 'react', id: 'hooks', title: 'Hooks', group: 'Reference' },
  ],
  questions: [
    ...Array.from({ length: 12 }, (_, i) => question('typescript', `t${String(i)}`, 'narrowing')),
    question('react', 'r1', 'hooks'),
  ],
}

function backend(): InterviewBackend {
  const state = openInterviewState(':memory:')
  return { sources: ['typescript', 'react'], bank: () => bank, state: () => state, now: () => NOW }
}

const get = (path: string) => new Request(`http://127.0.0.1:3002${path}`)
const post = (body: unknown) =>
  new Request('http://127.0.0.1:3002/api/interview/review', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

describe('handleOverview (ADR-0018)', () => {
  it('gives the main screen for the chosen sources, and all of them by default', async () => {
    const one = backend()
    const all = (await handleOverview(
      () => one,
      get('/api/interview/overview'),
    ).json()) as PracticeOverview
    const react = (await handleOverview(
      () => one,
      get('/api/interview/overview?sources=react'),
    ).json()) as PracticeOverview

    expect(all.sources).toEqual([
      { id: 'typescript', questions: 12 },
      { id: 'react', questions: 1 },
    ])
    expect(all.summary).toEqual({ questions: 13, seen: 0, good: 0, due: 0, reviews: 0 })
    expect(react.sources).toEqual([{ id: 'react', questions: 1 }])
  })

  it('refuses a source the app does not have, or none at all', async () => {
    const unknown = handleOverview(backend, get('/api/interview/overview?sources=rust'))
    const none = handleOverview(backend, get('/api/interview/overview?sources='))

    expect(unknown.status).toBe(400)
    expect(await unknown.json()).toEqual({
      error: 'this app has no rust (known: typescript, react)',
    })
    expect(none.status).toBe(400)
  })

  it('answers 500 when the backend cannot be built', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const response = handleOverview(() => {
      throw new Error('no bank')
    }, get('/api/interview/overview'))

    expect(response.status).toBe(500)
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })
})

describe('handleDeck', () => {
  it('gives Quick 10 across the chosen sources', async () => {
    const deck = (await handleDeck(backend, get('/api/interview/deck')).json()) as PracticeDeck

    expect(deck.cards).toHaveLength(10)
    expect(deck.cards.map(({ question: q }) => q.source)).toContain('react')
    expect(deck.cards.every(({ state }) => state === 'new')).toBe(true)
  })

  it('keeps to a topic and a count', async () => {
    const deck = (await handleDeck(
      backend,
      get('/api/interview/deck?topic=react:hooks&count=5'),
    ).json()) as PracticeDeck

    expect(deck.cards.map(({ question: q }) => q.id)).toEqual(['r1'])
    expect(deck.cards[0]?.topicTitle).toBe('Hooks')
  })

  it('refuses a bad topic or count', () => {
    expect(handleDeck(backend, get('/api/interview/deck?topic=hooks')).status).toBe(400)
    expect(
      handleDeck(backend, get(`/api/interview/deck?count=${String(MAX_DECK + 1)}`)).status,
    ).toBe(400)
    expect(handleDeck(backend, get('/api/interview/deck?count=0')).status).toBe(400)
  })
})

describe('handleReview', () => {
  it('schedules the card, keeps the rating, and says when it comes back', async () => {
    const one = backend()
    const response = await handleReview(() => one, post({ questionId: 't1', rating: 'good' }))
    const result = (await response.json()) as ReviewResult

    expect(response.status).toBe(200)
    expect(result.questionId).toBe('t1')
    expect(result.due > NOW.toISOString()).toBe(true)
    expect(one.state().reviewCount()).toBe(1)
    expect(one.state().card('t1')).toMatchObject({ due: result.due, lastRating: 3, reviews: 1 })
    const overview = (await handleOverview(
      () => one,
      get('/api/interview/overview'),
    ).json()) as PracticeOverview
    expect(overview.summary).toMatchObject({ seen: 1, good: 1, reviews: 1 })
  })

  it('refuses a body that is not a review, and a question the bank does not have', async () => {
    expect((await handleReview(backend, post('not json'))).status).toBe(400)
    expect((await handleReview(backend, post({ questionId: 't1', rating: 'great' }))).status).toBe(
      400,
    )
    const missing = await handleReview(backend, post({ questionId: 'nope', rating: 'good' }))
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({ error: 'the bank has no question nope' })
  })
})

describe('handleFlag', () => {
  it('hides a card the owner flagged as wrong, and keeps the reason', async () => {
    const one = backend()
    const response = await handleFlag(
      () => one,
      post({ questionId: 'r1', reason: '  The code disagrees.  ' }),
    )

    expect(response.status).toBe(200)
    expect((await response.json()) as FlagResult).toEqual({
      questionId: 'r1',
      flaggedAt: NOW.toISOString(),
    })
    expect(one.state().flags()).toEqual([
      { questionId: 'r1', reason: 'The code disagrees.', flaggedAt: NOW.toISOString() },
    ])
    const overview = (await handleOverview(
      () => one,
      get('/api/interview/overview'),
    ).json()) as PracticeOverview
    expect(overview.sources).toEqual([
      { id: 'typescript', questions: 12 },
      { id: 'react', questions: 0 },
    ])
    const deck = (await handleDeck(
      () => one,
      get('/api/interview/deck?sources=react'),
    ).json()) as PracticeDeck
    expect(deck.cards).toEqual([])
  })

  it('refuses no reason, a body that is not a flag, and a question the bank does not have', async () => {
    expect((await handleFlag(backend, post('not json'))).status).toBe(400)
    const blank = await handleFlag(backend, post({ questionId: 't1', reason: ' ' }))
    expect(blank.status).toBe(400)
    expect(await blank.json()).toEqual({
      error: 'a flag is { questionId, reason }, with a reason of 1 to 2000 characters',
    })
    const missing = await handleFlag(backend, post({ questionId: 'nope', reason: 'Wrong.' }))
    expect(missing.status).toBe(404)
  })
})
