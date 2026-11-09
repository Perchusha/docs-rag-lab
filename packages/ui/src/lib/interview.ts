// The interview-prep app's pure logic (ADR-0018): which key does what on a card, what the topic
// search keeps, and the words for progress and for the mock interview. Components stay thin.
import type {
  MockSummary,
  PracticeSummary,
  QuestionKind,
  Rating,
  TopicGroup,
  TopicProgress,
} from '@docs-rag-lab/contracts'

const TEXT_FIELD =
  'textarea, input:not([type="checkbox"], [type="radio"]), select, [contenteditable]'
const INTERACTIVE = `${TEXT_FIELD}, button, a[href], summary, [role="button"]`

/** The key a card reads, and where focus was when it was pressed. */
export interface CardKey {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  /** Focus was in a text field, such as the answer field. */
  typing: boolean
  /** Focus was on something the key already works on, such as a button or a link. */
  interactive: boolean
}

export type CardAction = { type: 'reveal' } | { type: 'rate'; rating: Rating }

const RATING_KEYS: Readonly<Record<string, Rating>> = {
  1: 'again',
  2: 'hard',
  3: 'good',
  4: 'easy',
}

/**
 * What a key does on a card. Nothing fires while typing: in the answer field, Ctrl+Enter (or
 * Cmd+Enter) reveals the answer, and every other key types. Outside it, Space reveals the answer
 * unless focus is on something Space already works on, and 1 to 4 rate, only once the answer is
 * shown.
 */
export function cardAction(event: CardKey, revealed: boolean): CardAction | undefined {
  const command = event.ctrlKey || event.metaKey
  if (event.typing) {
    return event.key === 'Enter' && command && !event.altKey && !revealed
      ? { type: 'reveal' }
      : undefined
  }
  if (command || event.altKey) return undefined
  if (event.key === ' ' && !revealed && !event.interactive) return { type: 'reveal' }
  const rating = RATING_KEYS[event.key]
  return rating !== undefined && revealed ? { type: 'rate', rating } : undefined
}

/** Where focus is, for cardAction. */
export function focusOf(target: EventTarget | null): Pick<CardKey, 'typing' | 'interactive'> {
  if (!(target instanceof Element)) return { typing: false, interactive: false }
  return { typing: target.matches(TEXT_FIELD), interactive: target.matches(INTERACTIVE) }
}

/**
 * The topic map under a search: groups keep only the topics whose title holds every word of the
 * query, and a group with none goes. An empty query keeps everything.
 */
export function filterGroups(groups: readonly TopicGroup[], query: string): TopicGroup[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return [...groups]
  return groups.flatMap((group) => {
    const topics = group.topics.filter((topic) => {
      const title = topic.title.toLowerCase()
      return words.every((word) => title.includes(word))
    })
    return topics.length === 0 ? [] : [{ ...group, topics }]
  })
}

const plural = (count: number, one: string, many = `${one}s`): string =>
  `${String(count)} ${count === 1 ? one : many}`

/** A topic's progress in words, never by colour alone. */
export function topicProgressText(topic: TopicProgress): string {
  if (topic.seen === 0) return `${plural(topic.questions, 'question')}, all new`
  const parts = [
    `${String(topic.seen)} of ${String(topic.questions)} seen`,
    `${String(topic.good)} good`,
  ]
  if (topic.due > 0) parts.push(`${String(topic.due)} due`)
  return parts.join(', ')
}

/** How much of a topic was seen, as a share for the bar beside the words. */
export const seenShare = (topic: TopicProgress): number =>
  topic.questions === 0 ? 0 : topic.seen / topic.questions

/** The first run has no rating yet, so "Due today: 0" would say nothing. */
export const isFirstRun = (summary: PracticeSummary): boolean => summary.reviews === 0

export function summaryText(summary: PracticeSummary): string {
  const good = summary.seen === 0 ? 0 : Math.round((summary.good / summary.seen) * 100)
  return `${plural(summary.due, 'card')} due now. ${String(summary.seen)} of ${String(summary.questions)} seen, ${String(good)}% of them good.`
}

export const KIND_LABELS: Readonly<Record<QuestionKind, string>> = {
  'compiler-error': 'Compiler: which error?',
  'compiler-type': 'Compiler: which type?',
  pitfall: 'Pitfall',
  theory: 'Theory',
}

export const RATING_LABELS: Readonly<Record<Rating, string>> = {
  again: 'Again',
  hard: 'Hard',
  good: 'Good',
  easy: 'Easy',
}

/** When a card comes back, in words a person would use. */
export function dueText(due: string, now: Date): string {
  const minutes = Math.round((new Date(due).getTime() - now.getTime()) / 60_000)
  if (minutes < 60) return `in ${plural(Math.max(1, minutes), 'minute')}`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `in ${plural(hours, 'hour')}`
  return `in ${plural(Math.round(hours / 24), 'day')}`
}

/** A mock interview's score in words, never by colour alone. */
export const scoreText = (score: number, max: number): string =>
  `${String(score)} of ${String(max)}`

/** What grading cost, at list prices, in words. */
export function costText(usd: number): string {
  if (usd === 0) return 'nothing'
  return usd < 0.005 ? 'less than a cent' : `about $${usd.toFixed(2)}`
}

/** The first line of a mock interview's summary. */
export function mockSummaryText(summary: MockSummary): string {
  const answered = summary.questions.length
  if (answered === 0) return 'No answer was graded.'
  return `${scoreText(summary.score, summary.max)} over ${plural(answered, 'question')}. Grading cost ${costText(summary.costUsd)} at list prices.`
}
