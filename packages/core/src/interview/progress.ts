// Practice and progress in the interview-prep app (ADR-0018): FSRS schedules each card, Quick 10
// and a topic's practice pick the cards, and the topic map counts what was seen and how it went.
// The scheduler is ts-fsrs, behind this file alone.
import { join } from 'node:path'

import type {
  BankQuestion,
  BankTopic,
  PracticeCard,
  PracticeOverview,
  Rating,
  TopicGroup,
  TopicProgress,
} from '@docs-rag-lab/contracts'
import type { StoredCard } from '@docs-rag-lab/db'
import { sha256Hex } from '@docs-rag-lab/source-kit'
import {
  DefaultScheduler,
  Rating as FsrsRating,
  type DefaultSchedulerCard,
  type Grade,
} from 'ts-fsrs'

/** The bank as the app reads it: the topics in scope and the questions it shows. */
export interface LoadedBank {
  topics: BankTopic[]
  questions: BankQuestion[]
}

/** Where the interview-prep app keeps its progress and flags (SPEC section 4), under the data folder. */
export const interviewStatePath = (root: string, dataDir: string): string =>
  join(root, dataDir, 'apps', 'interview-prep.sqlite')

/**
 * The bank without the cards the owner flagged as wrong (ADR-0018): those are hidden for them,
 * whatever the bank says, and neither practised nor counted.
 */
export function withoutFlagged(bank: LoadedBank, flagged: Iterable<string>): LoadedBank {
  const hidden = new Set(flagged)
  if (hidden.size === 0) return bank
  return { topics: bank.topics, questions: bank.questions.filter(({ id }) => !hidden.has(id)) }
}

/**
 * ts-fsrs 6, which patches no prototype on import (ADR-0018). Built on first use, since it is
 * built asynchronously, and with no fuzz, so that the same ratings always give the same days.
 */
let scheduler: Promise<DefaultScheduler> | undefined
const schedulerOnce = (): Promise<DefaultScheduler> =>
  (scheduler ??= DefaultScheduler({ enableFuzz: false }))

const GRADES: Readonly<Record<Rating, Grade>> = {
  again: FsrsRating.Again,
  hard: FsrsRating.Hard,
  good: FsrsRating.Good,
  easy: FsrsRating.Easy,
}

/** Good and easy: the card was known. */
const KNOWN = new Set<number>([FsrsRating.Good, FsrsRating.Easy])

/**
 * A stored card as ts-fsrs takes it, with its dates as dates again. A card written by ts-fsrs 5,
 * which PR 2 shipped, has none of ts-fsrs 6's fields, so FSRS starts it over.
 */
function reviveCard(state: string): DefaultSchedulerCard | undefined {
  const card = JSON.parse(state) as Record<string, unknown>
  if (typeof card.dueAt !== 'string') return undefined
  const lastReviewAt = typeof card.lastReviewAt === 'string' ? new Date(card.lastReviewAt) : null
  return { ...card, dueAt: new Date(card.dueAt), lastReviewAt } as DefaultSchedulerCard
}

/** A card after one more rating, as the store keeps it. */
export async function scheduleReview(
  previous: StoredCard | undefined,
  questionId: string,
  rating: Rating,
  now: Date,
): Promise<StoredCard> {
  const fsrs = await schedulerOnce()
  const card =
    (previous === undefined ? undefined : reviveCard(previous.state)) ??
    fsrs.newCard({ now, cardId: questionId })
  const grade = GRADES[rating]
  const { card: next } = fsrs.review({ card, grade, now })
  return {
    questionId,
    state: JSON.stringify(next),
    due: next.dueAt.toISOString(),
    lastRating: grade,
    reviews: (previous?.reviews ?? 0) + 1,
  }
}

const topicKey = (source: string, id: string): string => `${source}\n${id}`

const isDue = (card: StoredCard, now: Date): boolean => card.due <= now.toISOString()

/** The main screen: each chosen source's size, its topics with their progress, and the totals. */
export function practiceOverview(
  bank: LoadedBank,
  cards: readonly StoredCard[],
  reviews: number,
  sources: readonly string[],
  now: Date,
): PracticeOverview {
  const byId = new Map(cards.map((card) => [card.questionId, card]))
  const chosen = bank.questions.filter((question) => sources.includes(question.source))
  const progress = new Map<string, TopicProgress>()
  for (const topic of bank.topics) {
    if (!sources.includes(topic.source)) continue
    progress.set(topicKey(topic.source, topic.id), {
      ...topic,
      questions: 0,
      seen: 0,
      good: 0,
      due: 0,
    })
  }
  const summary = { questions: 0, seen: 0, good: 0, due: 0, reviews }
  for (const question of chosen) {
    const topic = progress.get(topicKey(question.source, question.topicId))
    const card = byId.get(question.id)
    const counts = [summary, ...(topic === undefined ? [] : [topic])]
    for (const count of counts) {
      count.questions++
      if (card === undefined) continue
      count.seen++
      if (KNOWN.has(card.lastRating)) count.good++
      if (isDue(card, now)) count.due++
    }
  }
  const groups: TopicGroup[] = []
  for (const topic of progress.values()) {
    if (topic.questions === 0) continue
    let group = groups.find((item) => item.source === topic.source && item.group === topic.group)
    if (group === undefined) {
      group = { source: topic.source, group: topic.group, topics: [] }
      groups.push(group)
    }
    group.topics.push(topic)
  }
  groups.sort((a, b) => sources.indexOf(a.source) - sources.indexOf(b.source))
  return {
    sources: sources.map((id) => ({
      id,
      questions: chosen.filter((question) => question.source === id).length,
    })),
    groups,
    summary,
  }
}

export interface PickOptions {
  sources: readonly string[]
  /** One topic's cards instead of every chosen source's. */
  topic?: { source: string; id: string } | undefined
  count: number
  now: Date
}

/**
 * The cards to practise: those due first, the longest overdue first, then new ones, taking a
 * source in turn so that every chosen technology comes up. New cards come in an order that
 * changes from day to day and stays the same within one.
 */
export function pickCards(
  bank: LoadedBank,
  cards: readonly StoredCard[],
  options: PickOptions,
): PracticeCard[] {
  const { sources, topic, count, now } = options
  const byId = new Map(cards.map((card) => [card.questionId, card]))
  const titles = new Map(bank.topics.map((item) => [topicKey(item.source, item.id), item.title]))
  const candidates = bank.questions.filter(
    (question) =>
      sources.includes(question.source) &&
      (topic === undefined || (question.source === topic.source && question.topicId === topic.id)),
  )
  const card = (question: BankQuestion, state: PracticeCard['state']): PracticeCard => ({
    question,
    state,
    topicTitle: titles.get(topicKey(question.source, question.topicId)) ?? question.topicId,
  })

  const due = candidates
    .flatMap((question) => {
      const stored = byId.get(question.id)
      return stored !== undefined && isDue(stored, now) ? [{ question, due: stored.due }] : []
    })
    .sort((a, b) => a.due.localeCompare(b.due) || a.question.id.localeCompare(b.question.id))
    .map(({ question }) => card(question, 'due'))

  const day = now.toISOString().slice(0, 10)
  const order = (question: BankQuestion): string => sha256Hex(`${day}\n${question.id}`)
  const fresh = sources.map((source) =>
    candidates
      .filter((question) => question.source === source && !byId.has(question.id))
      .sort((a, b) => order(a).localeCompare(order(b))),
  )
  const interleaved: PracticeCard[] = []
  for (let i = 0; fresh.some((list) => i < list.length); i++) {
    for (const list of fresh) {
      const question = list[i]
      if (question !== undefined) interleaved.push(card(question, 'new'))
    }
  }
  return [...due, ...interleaved].slice(0, count)
}
