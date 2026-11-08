import type { BankQuestion, BankTopic } from '@docs-rag-lab/contracts'
import type { StoredCard } from '@docs-rag-lab/db'
import { describe, expect, it } from 'vitest'

import { pickCards, practiceOverview, scheduleReview, type LoadedBank } from './progress.ts'

const NOW = new Date('2026-11-08T12:00:00.000Z')

const question = (source: string, id: string, topicId: string): BankQuestion => ({
  id,
  source,
  kind: 'theory',
  topicId,
  prompt: `Question ${id}?`,
  answer: 'Answer.',
  citation: { url: 'u', title: 't', sectionPath: [], docPath: 'p', chunkId: `chunk-${id}` },
  verifiedBy: 'checker',
})

const topics: BankTopic[] = [
  { source: 'typescript', id: 'narrowing', title: 'Narrowing', group: 'Handbook' },
  { source: 'typescript', id: 'generics', title: 'Generics', group: 'Handbook' },
  { source: 'typescript', id: 'empty', title: 'No questions', group: 'Handbook' },
  { source: 'typescript', id: 'options', title: 'Compiler options', group: 'Compiler options' },
  { source: 'react', id: 'hooks', title: 'Hooks', group: 'Reference' },
]

const bank: LoadedBank = {
  topics,
  questions: [
    question('typescript', 't1', 'narrowing'),
    question('typescript', 't2', 'narrowing'),
    question('typescript', 't3', 'generics'),
    question('typescript', 't4', 'options'),
    question('react', 'r1', 'hooks'),
    question('react', 'r2', 'hooks'),
  ],
}

const stored = (questionId: string, due: string, lastRating: number): StoredCard => ({
  questionId,
  state: '{}',
  due,
  lastRating,
  reviews: 1,
})

describe('scheduleReview (ADR-0018)', () => {
  it('schedules a new card by its rating, later for a better one', () => {
    const again = scheduleReview(undefined, 'q1', 'again', NOW)
    const good = scheduleReview(undefined, 'q1', 'good', NOW)
    const easy = scheduleReview(undefined, 'q1', 'easy', NOW)

    expect(again).toMatchObject({ questionId: 'q1', lastRating: 1, reviews: 1 })
    expect(good.lastRating).toBe(3)
    expect(again.due > NOW.toISOString()).toBe(true)
    expect(again.due < good.due).toBe(true)
    expect(good.due < easy.due).toBe(true)
  })

  it('goes on from the stored state, and gives the same days every time', () => {
    const first = scheduleReview(undefined, 'q1', 'good', NOW)
    const later = new Date(first.due)
    const second = scheduleReview(first, 'q1', 'good', later)

    expect(second.reviews).toBe(2)
    expect(new Date(second.due).getTime() - later.getTime()).toBeGreaterThan(
      new Date(first.due).getTime() - NOW.getTime(),
    )
    expect(scheduleReview(first, 'q1', 'good', later)).toEqual(second)
  })
})

describe('practiceOverview', () => {
  const cards = [
    stored('t1', '2026-11-07T12:00:00.000Z', 3),
    stored('t2', '2026-11-20T12:00:00.000Z', 1),
    stored('r1', '2026-11-08T11:00:00.000Z', 4),
  ]

  it('counts each topic and the whole, and leaves out topics with no question', () => {
    const overview = practiceOverview(bank, cards, 5, ['typescript', 'react'], NOW)

    expect(overview.sources).toEqual([
      { id: 'typescript', questions: 4 },
      { id: 'react', questions: 2 },
    ])
    expect(overview.summary).toEqual({ questions: 6, seen: 3, good: 2, due: 2, reviews: 5 })
    expect(
      overview.groups.map((group) => [group.source, group.group, group.topics.map(({ id }) => id)]),
    ).toEqual([
      ['typescript', 'Handbook', ['narrowing', 'generics']],
      ['typescript', 'Compiler options', ['options']],
      ['react', 'Reference', ['hooks']],
    ])
    expect(overview.groups[0]?.topics[0]).toEqual({
      source: 'typescript',
      id: 'narrowing',
      title: 'Narrowing',
      group: 'Handbook',
      questions: 2,
      seen: 2,
      good: 1,
      due: 1,
    })
  })

  it('counts only the chosen technologies, in the order chosen', () => {
    const overview = practiceOverview(bank, cards, 0, ['react'], NOW)

    expect(overview.sources).toEqual([{ id: 'react', questions: 2 }])
    expect(overview.summary).toMatchObject({ questions: 2, seen: 1, reviews: 0 })
    expect(overview.groups.map(({ source }) => source)).toEqual(['react'])
  })
})

describe('pickCards (Quick 10 and a topic)', () => {
  it('gives the due cards first, the longest overdue first, then new ones by source in turn', () => {
    const cards = [
      stored('t3', '2026-11-08T11:00:00.000Z', 1),
      stored('t1', '2026-11-01T12:00:00.000Z', 3),
      stored('t2', '2026-11-30T12:00:00.000Z', 3),
    ]

    const picked = pickCards(bank, cards, { sources: ['typescript', 'react'], count: 10, now: NOW })
    expect(picked.slice(0, 2).map(({ question, state }) => [question.id, state])).toEqual([
      ['t1', 'due'],
      ['t3', 'due'],
    ])
    expect(picked.slice(2).map(({ question }) => question.source)).toEqual([
      'typescript',
      'react',
      'react',
    ])
    expect(picked.map(({ question }) => question.id)).not.toContain('t2')
    expect(picked.find(({ question }) => question.id === 't1')?.topicTitle).toBe('Narrowing')
  })

  it('keeps to its count, its sources and its topic', () => {
    expect(
      pickCards(bank, [], { sources: ['typescript', 'react'], count: 3, now: NOW }),
    ).toHaveLength(3)
    expect(
      pickCards(bank, [], { sources: ['react'], count: 10, now: NOW }).every(
        ({ question }) => question.source === 'react',
      ),
    ).toBe(true)
    expect(
      pickCards(bank, [], {
        sources: ['typescript', 'react'],
        topic: { source: 'typescript', id: 'narrowing' },
        count: 10,
        now: NOW,
      })
        .map(({ question }) => question.id)
        .sort(),
    ).toEqual(['t1', 't2'])
  })

  it('orders new cards the same way all day, and another way the next day', () => {
    const many: LoadedBank = {
      topics,
      questions: Array.from({ length: 30 }, (_, i) =>
        question('typescript', `q${String(i)}`, 'narrowing'),
      ),
    }
    const ids = (now: Date) =>
      pickCards(many, [], { sources: ['typescript'], count: 30, now }).map(
        ({ question }) => question.id,
      )

    expect(ids(new Date('2026-11-08T23:00:00.000Z'))).toEqual(ids(NOW))
    expect(ids(new Date('2026-11-09T12:00:00.000Z'))).not.toEqual(ids(NOW))
  })
})
