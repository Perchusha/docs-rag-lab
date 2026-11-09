import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { openInterviewState, type StoredCard } from './interview-state.ts'

const card = (questionId: string, due: string, lastRating = 3, reviews = 1): StoredCard => ({
  questionId,
  state: JSON.stringify({ stability: 1 }),
  due,
  lastRating,
  reviews,
})

describe('the interview state (ADR-0018)', () => {
  it('starts empty', () => {
    const state = openInterviewState(':memory:')

    expect(state.cards()).toEqual([])
    expect(state.reviewCount()).toBe(0)
    expect(state.card('q1')).toBeUndefined()
    state.close()
  })

  it('keeps each rating, and the card as its last rating left it', () => {
    const state = openInterviewState(':memory:')
    state.saveReview({
      card: card('q1', '2026-11-09T10:00:00.000Z', 1),
      rating: 1,
      reviewedAt: '2026-11-08T10:00:00.000Z',
    })
    state.saveReview({
      card: card('q1', '2026-11-12T10:00:00.000Z', 3, 2),
      rating: 3,
      reviewedAt: '2026-11-09T10:00:00.000Z',
    })
    state.saveReview({
      card: card('q2', '2026-11-10T10:00:00.000Z'),
      rating: 3,
      reviewedAt: '2026-11-09T11:00:00.000Z',
    })

    expect(state.reviewCount()).toBe(3)
    expect(state.card('q1')).toEqual(card('q1', '2026-11-12T10:00:00.000Z', 3, 2))
    expect(state.cards().map(({ questionId }) => questionId)).toEqual(['q1', 'q2'])
    state.close()
  })

  it('keeps the cards flagged as wrong with the reason, the last reason winning', () => {
    const state = openInterviewState(':memory:')
    expect(state.flags()).toEqual([])
    state.saveFlag({
      questionId: 'q2',
      reason: 'Says set once.',
      flaggedAt: '2026-11-09T10:00:00.000Z',
    })
    state.saveFlag({
      questionId: 'q1',
      reason: 'Wrong line.',
      flaggedAt: '2026-11-09T11:00:00.000Z',
    })
    state.saveFlag({
      questionId: 'q2',
      reason: 'Says set once, and the code disagrees.',
      flaggedAt: '2026-11-09T12:00:00.000Z',
    })

    expect(state.flags()).toEqual([
      { questionId: 'q1', reason: 'Wrong line.', flaggedAt: '2026-11-09T11:00:00.000Z' },
      {
        questionId: 'q2',
        reason: 'Says set once, and the code disagrees.',
        flaggedAt: '2026-11-09T12:00:00.000Z',
      },
    ])
    state.close()
  })

  it('creates its folder and keeps the state across openings', () => {
    const root = mkdtempSync(join(tmpdir(), 'interview-state-'))
    const path = join(root, 'apps', 'interview-prep.sqlite')
    const first = openInterviewState(path)
    first.saveReview({
      card: card('q1', '2026-11-09T10:00:00.000Z'),
      rating: 3,
      reviewedAt: '2026-11-08T10:00:00.000Z',
    })
    first.close()

    expect(existsSync(path)).toBe(true)
    const second = openInterviewState(path)
    expect(second.cards()).toHaveLength(1)
    second.close()
    rmSync(root, { recursive: true, force: true })
  })
})
