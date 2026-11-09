// The interview-prep app's routes as plain functions from a Request to a Response (ADR-0018), so
// they are tested without Next.js. Each route file of the app is one line that calls one of these
// with the app's backend (apps/CLAUDE.md: routes stay thin). None calls a model.
import {
  MAX_FLAG_REASON,
  parseFlagRequest,
  parseReviewRequest,
  type FlagResult,
  type PracticeDeck,
  type PracticeOverview,
  type ReviewResult,
} from '@docs-rag-lab/contracts'
import {
  pickCards,
  practiceOverview,
  scheduleReview,
  withoutFlagged,
  type InterviewState,
  type LoadedBank,
} from '@docs-rag-lab/core'

/** What the routes read and write: the bank, the progress store and the clock. */
export interface InterviewBackend {
  /** The sources the app offers, in the order it lists them. */
  sources: readonly string[]
  bank(): LoadedBank
  state(): Pick<
    InterviewState,
    'cards' | 'card' | 'saveReview' | 'reviewCount' | 'saveFlag' | 'flags' | 'close'
  >
  now(): Date
}

/** Builds the backend on first use; a failure there becomes a 500, not a crash. */
export type BackendFactory = () => InterviewBackend

/** A deck is a sitting, not a backlog. */
export const MAX_DECK = 50
export const QUICK_DECK = 10

const NO_STORE = { 'cache-control': 'no-store' }

const fail = (status: number, error: string): Response => Response.json({ error }, { status })

function failure(error: unknown): Response {
  console.error(error)
  return fail(500, error instanceof Error ? error.message : String(error))
}

/** The bank as the owner sees it: without the cards they flagged as wrong. */
function visibleBank(backend: InterviewBackend): LoadedBank {
  return withoutFlagged(
    backend.bank(),
    backend
      .state()
      .flags()
      .map(({ questionId }) => questionId),
  )
}

/** `?sources=typescript,react`: some of the app's sources, or all of them when absent. */
function sourcesOf(url: URL, backend: InterviewBackend): string[] | Response {
  const value = url.searchParams.get('sources')
  if (value === null) return [...backend.sources]
  const asked = value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '')
  const unknown = asked.filter((id) => !backend.sources.includes(id))
  if (asked.length === 0) return fail(400, 'choose at least one technology')
  if (unknown.length > 0) {
    return fail(400, `this app has no ${unknown.join(', ')} (known: ${backend.sources.join(', ')})`)
  }
  // In the app's order, whatever order the request names them in.
  return backend.sources.filter((id) => asked.includes(id))
}

/** GET /api/interview/overview: the main screen. */
export function handleOverview(factory: BackendFactory, request: Request): Response {
  try {
    const backend = factory()
    const sources = sourcesOf(new URL(request.url), backend)
    if (sources instanceof Response) return sources
    const state = backend.state()
    const overview: PracticeOverview = practiceOverview(
      visibleBank(backend),
      state.cards(),
      state.reviewCount(),
      sources,
      backend.now(),
    )
    return Response.json(overview, { headers: NO_STORE })
  } catch (error) {
    return failure(error)
  }
}

/** `topic=typescript:handbook-v2/Narrowing`: one topic of one source. */
function topicOf(value: string | null): { source: string; id: string } | undefined | Response {
  if (value === null) return undefined
  const at = value.indexOf(':')
  if (at <= 0 || at === value.length - 1) return fail(400, 'topic must be <source>:<topic id>')
  return { source: value.slice(0, at), id: value.slice(at + 1) }
}

function countOf(value: string | null): number | Response {
  if (value === null) return QUICK_DECK
  const count = Number(value)
  return Number.isInteger(count) && count >= 1 && count <= MAX_DECK
    ? count
    : fail(400, `count must be a whole number from 1 to ${String(MAX_DECK)}`)
}

/** GET /api/interview/deck: Quick 10 across the chosen sources, or a topic's practice. */
export function handleDeck(factory: BackendFactory, request: Request): Response {
  try {
    const backend = factory()
    const url = new URL(request.url)
    const sources = sourcesOf(url, backend)
    if (sources instanceof Response) return sources
    const topic = topicOf(url.searchParams.get('topic'))
    if (topic instanceof Response) return topic
    const count = countOf(url.searchParams.get('count'))
    if (count instanceof Response) return count
    const deck: PracticeDeck = {
      cards: pickCards(visibleBank(backend), backend.state().cards(), {
        sources: topic === undefined ? sources : [topic.source],
        topic,
        count,
        now: backend.now(),
      }),
    }
    return Response.json(deck, { headers: NO_STORE })
  } catch (error) {
    return failure(error)
  }
}

/** POST /api/interview/review: one rating of one card, and when FSRS shows it again. */
export async function handleReview(factory: BackendFactory, request: Request): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, 'the body must be JSON')
  }
  const review = parseReviewRequest(body)
  if (review === undefined) {
    return fail(400, 'a review is { questionId, rating }, with rating again, hard, good or easy')
  }
  try {
    const backend = factory()
    if (!backend.bank().questions.some(({ id }) => id === review.questionId)) {
      return fail(404, `the bank has no question ${review.questionId}`)
    }
    const state = backend.state()
    const now = backend.now()
    const card = await scheduleReview(
      state.card(review.questionId),
      review.questionId,
      review.rating,
      now,
    )
    state.saveReview({ card, rating: card.lastRating, reviewedAt: now.toISOString() })
    const result: ReviewResult = { questionId: review.questionId, due: card.due }
    return Response.json(result, { headers: NO_STORE })
  } catch (error) {
    return failure(error)
  }
}

/**
 * POST /api/interview/flag: the owner found a card's answer wrong. The card is hidden for them,
 * and the reason is kept in the progress store, for `drl questions flagged` (ADR-0018).
 */
export async function handleFlag(factory: BackendFactory, request: Request): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, 'the body must be JSON')
  }
  const flag = parseFlagRequest(body)
  if (flag === undefined) {
    return fail(
      400,
      `a flag is { questionId, reason }, with a reason of 1 to ${String(MAX_FLAG_REASON)} characters`,
    )
  }
  try {
    const backend = factory()
    if (!backend.bank().questions.some(({ id }) => id === flag.questionId)) {
      return fail(404, `the bank has no question ${flag.questionId}`)
    }
    const flaggedAt = backend.now().toISOString()
    backend.state().saveFlag({ ...flag, flaggedAt })
    const result: FlagResult = { questionId: flag.questionId, flaggedAt }
    return Response.json(result, { headers: NO_STORE })
  } catch (error) {
    return failure(error)
  }
}
