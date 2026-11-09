import type { MockSummary, TopicGroup, TopicProgress } from '@docs-rag-lab/contracts'
import { describe, expect, it } from 'vitest'

import {
  cardAction,
  costText,
  dueText,
  filterGroups,
  isFirstRun,
  mockSummaryText,
  scoreText,
  summaryText,
  topicProgressText,
  type CardKey,
} from './interview.ts'

const key = (overrides: Partial<CardKey>): CardKey => ({
  key: ' ',
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  typing: false,
  interactive: false,
  ...overrides,
})

describe('cardAction (ADR-0018)', () => {
  it('never fires while typing, but for Ctrl+Enter or Cmd+Enter to reveal', () => {
    for (const k of [' ', '1', '2', '3', '4', 'Enter']) {
      expect(cardAction(key({ key: k, typing: true }), false)).toBeUndefined()
      expect(cardAction(key({ key: k, typing: true }), true)).toBeUndefined()
    }
    expect(cardAction(key({ key: 'Enter', ctrlKey: true, typing: true }), false)).toEqual({
      type: 'reveal',
    })
    expect(cardAction(key({ key: 'Enter', metaKey: true, typing: true }), false)).toEqual({
      type: 'reveal',
    })
    expect(cardAction(key({ key: 'Enter', ctrlKey: true, typing: true }), true)).toBeUndefined()
  })

  it('reveals with Space outside the field, unless Space works on what has focus', () => {
    expect(cardAction(key({}), false)).toEqual({ type: 'reveal' })
    expect(cardAction(key({ interactive: true }), false)).toBeUndefined()
    expect(cardAction(key({}), true)).toBeUndefined()
    expect(cardAction(key({ ctrlKey: true }), false)).toBeUndefined()
  })

  it('rates with 1 to 4 only once the answer is shown', () => {
    expect(cardAction(key({ key: '3' }), false)).toBeUndefined()
    expect(cardAction(key({ key: '1' }), true)).toEqual({ type: 'rate', rating: 'again' })
    expect(cardAction(key({ key: '4', interactive: true }), true)).toEqual({
      type: 'rate',
      rating: 'easy',
    })
    expect(cardAction(key({ key: '5' }), true)).toBeUndefined()
    expect(cardAction(key({ key: '2', altKey: true }), true)).toBeUndefined()
  })
})

const topic = (title: string, overrides: Partial<TopicProgress> = {}): TopicProgress => ({
  source: 'typescript',
  id: title,
  title,
  group: 'Handbook',
  questions: 10,
  seen: 0,
  good: 0,
  due: 0,
  ...overrides,
})

const groups: TopicGroup[] = [
  { source: 'typescript', group: 'Handbook', topics: [topic('Narrowing'), topic('Object Types')] },
  { source: 'react', group: 'Reference', topics: [topic('Hooks'), topic('React DOM')] },
]

describe('filterGroups', () => {
  it('keeps the topics whose title holds every word, and drops empty groups', () => {
    expect(
      filterGroups(groups, 'object').map((group) => group.topics.map(({ title }) => title)),
    ).toEqual([['Object Types']])
    expect(filterGroups(groups, 'react dom')[0]?.topics.map(({ title }) => title)).toEqual([
      'React DOM',
    ])
    expect(filterGroups(groups, 'nothing')).toEqual([])
  })

  it('keeps everything for an empty query', () => {
    expect(filterGroups(groups, '  ')).toEqual(groups)
  })
})

describe('progress in words', () => {
  it('says a topic is new, or how much was seen, good and due', () => {
    expect(topicProgressText(topic('A'))).toBe('10 questions, all new')
    expect(topicProgressText(topic('A', { questions: 1 }))).toBe('1 question, all new')
    expect(topicProgressText(topic('A', { seen: 4, good: 3 }))).toBe('4 of 10 seen, 3 good')
    expect(topicProgressText(topic('A', { seen: 4, good: 3, due: 2 }))).toBe(
      '4 of 10 seen, 3 good, 2 due',
    )
  })

  it('tells the first run, and sums up the rest', () => {
    const summary = { questions: 20, seen: 8, good: 6, due: 1, reviews: 9 }

    expect(isFirstRun({ ...summary, reviews: 0 })).toBe(true)
    expect(isFirstRun(summary)).toBe(false)
    expect(summaryText(summary)).toBe('1 card due now. 8 of 20 seen, 75% of them good.')
  })

  it('says when a card comes back', () => {
    const now = new Date('2026-11-08T12:00:00.000Z')

    expect(dueText('2026-11-08T12:01:00.000Z', now)).toBe('in 1 minute')
    expect(dueText('2026-11-08T12:10:00.000Z', now)).toBe('in 10 minutes')
    expect(dueText('2026-11-08T15:00:00.000Z', now)).toBe('in 3 hours')
    expect(dueText('2026-11-11T12:00:00.000Z', now)).toBe('in 3 days')
  })
})

describe('the words of the mock interview', () => {
  const summary: MockSummary = {
    sessionId: 's1',
    questions: [
      { questionId: 'q1', source: 'react', topicTitle: 'Hooks', prompt: 'Q?', score: 3, max: 4 },
      { questionId: 'q2', source: 'react', topicTitle: 'State', prompt: 'Q?', score: 2, max: 2 },
    ],
    score: 5,
    max: 6,
    weakTopics: [],
    read: [],
    costUsd: 0.0312,
  }

  it('says the score and what grading cost, in words', () => {
    expect(scoreText(1, 2)).toBe('1 of 2')
    expect(mockSummaryText(summary)).toBe(
      '5 of 6 over 2 questions. Grading cost about $0.03 at list prices.',
    )
    expect(costText(0)).toBe('nothing')
    expect(costText(0.004)).toBe('less than a cent')
    expect(mockSummaryText({ ...summary, questions: [] })).toBe('No answer was graded.')
  })
})
