// Practice and progress in the interview-prep app (ADR-0018): FSRS schedules each card, Quick 10
// and a topic's practice pick the cards, and the topic map counts what was seen and how it went.
// The scheduler is ts-fsrs, behind this file alone.
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
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating as FsrsRating,
  type CardInput,
  type Grade,
} from 'ts-fsrs'

/** The bank as the app reads it: the topics in scope and the questions it shows. */
export interface LoadedBank {
  topics: BankTopic[]
  questions: BankQuestion[]
}

/** No fuzz, so that the same ratings always give the same days. */
const scheduler = fsrs(generatorParameters({ enable_fuzz: false }))

const GRADES: Readonly<Record<Rating, Grade>> = {
  again: FsrsRating.Again,
  hard: FsrsRating.Hard,
  good: FsrsRating.Good,
  easy: FsrsRating.Easy,
}

/** Good and easy: the card was known. */
const KNOWN = new Set<number>([FsrsRating.Good, FsrsRating.Easy])

/** A card after one more rating, as the store keeps it. */
export function scheduleReview(
  previous: StoredCard | undefined,
  questionId: string,
  rating: Rating,
  now: Date,
): StoredCard {
  // The stored state is a ts-fsrs card as JSON: its dates come back as strings, which it takes.
  const card: CardInput =
    previous === undefined ? createEmptyCard(now) : (JSON.parse(previous.state) as CardInput)
  const grade = GRADES[rating]
  const { card: next } = scheduler.next(card, now, grade)
  return {
    questionId,
    state: JSON.stringify(next),
    due: next.due.toISOString(),
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
