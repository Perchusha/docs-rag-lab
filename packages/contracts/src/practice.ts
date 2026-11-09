// Practice in the interview-prep app (ADR-0018): what its routes return and accept. Progress is
// spaced repetition by FSRS: a card is new until rated, then due again on the day FSRS says.
import type { BankQuestion } from './interview.ts'

/** The four ratings of a card, worst first, as FSRS takes them. */
export const RATINGS = ['again', 'hard', 'good', 'easy'] as const
export type Rating = (typeof RATINGS)[number]

/** One topic of the topic map, with how far practice has come in it. */
export interface TopicProgress {
  source: string
  id: string
  title: string
  /** The section it is listed under, such as Handbook. */
  group: string
  questions: number
  /** Questions rated at least once. */
  seen: number
  /** Questions whose last rating was good or easy. */
  good: number
  /** Seen questions whose next review is due now. */
  due: number
}

/** A section of the topic map: one group of one source. */
export interface TopicGroup {
  source: string
  group: string
  topics: TopicProgress[]
}

export interface PracticeSummary {
  questions: number
  seen: number
  good: number
  due: number
  /** Every rating ever given. None means the first run. */
  reviews: number
}

/** The main screen: what each chosen technology has, and how far practice has come. */
export interface PracticeOverview {
  sources: { id: string; questions: number }[]
  groups: TopicGroup[]
  summary: PracticeSummary
}

/** A card to practise: a question, why it was picked, and its topic's title. */
export interface PracticeCard {
  question: BankQuestion
  /** Never rated, or rated and due again now. */
  state: 'new' | 'due'
  topicTitle: string
}

export interface PracticeDeck {
  cards: PracticeCard[]
}

export interface ReviewRequest {
  questionId: string
  rating: Rating
}

export interface ReviewResult {
  questionId: string
  /** When FSRS shows the card again, as an ISO date and time. */
  due: string
}

/** A review request as JSON, checked. Anything else gives undefined. */
export function parseReviewRequest(value: unknown): ReviewRequest | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const { questionId, rating } = value as Partial<Record<keyof ReviewRequest, unknown>>
  if (typeof questionId !== 'string' || questionId === '') return undefined
  const known = RATINGS.find((name) => name === rating)
  return known === undefined ? undefined : { questionId, rating: known }
}

/** The longest reason a flag keeps. */
export const MAX_FLAG_REASON = 2_000

/**
 * The owner found a card's answer wrong (ADR-0018). The card is hidden for them, and the reason
 * is kept locally, so that `drl questions flagged` can list it for a rejection in the bank.
 */
export interface FlagRequest {
  questionId: string
  reason: string
}

export interface FlagResult {
  questionId: string
  /** When the card was flagged, as an ISO date and time. */
  flaggedAt: string
}

/** A flag request as JSON, checked, with its reason trimmed. Anything else gives undefined. */
export function parseFlagRequest(value: unknown): FlagRequest | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const { questionId, reason } = value as Partial<Record<keyof FlagRequest, unknown>>
  if (typeof questionId !== 'string' || questionId === '') return undefined
  if (typeof reason !== 'string') return undefined
  const trimmed = reason.trim()
  if (trimmed === '' || trimmed.length > MAX_FLAG_REASON) return undefined
  return { questionId, reason: trimmed }
}
