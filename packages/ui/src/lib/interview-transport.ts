// How the interview-prep app's ui talks to its routes (ADR-0018). The app passes its route URLs as
// endpoints, and fetchInterviewTransport calls them. Stories pass their own transport instead.
import type {
  PracticeDeck,
  PracticeOverview,
  ReviewRequest,
  ReviewResult,
} from '@docs-rag-lab/contracts'

export interface InterviewEndpoints {
  /** GET with ?sources=: the PracticeOverview. */
  overview: string
  /** GET with ?sources= and, for a topic, &topic=<source>:<id>: the PracticeDeck. */
  deck: string
  /** POST a ReviewRequest: the ReviewResult. */
  review: string
}

export interface InterviewTransport {
  overview(sources: readonly string[]): Promise<PracticeOverview>
  deck(sources: readonly string[], topic?: { source: string; id: string }): Promise<PracticeDeck>
  review(request: ReviewRequest): Promise<ReviewResult>
}

/** The error a route sent as `{ "error": "..." }`, or the HTTP status. */
async function failure(response: Response): Promise<Error> {
  let message = `${String(response.status)} ${response.statusText}`.trim()
  try {
    const body: unknown = await response.json()
    if (typeof body === 'object' && body !== null && 'error' in body) {
      if (typeof body.error === 'string') message = body.error
    }
  } catch {
    // Not JSON: keep the status line.
  }
  return new Error(message)
}

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) throw await failure(response)
  return (await response.json()) as T
}

const withQuery = (url: string, query: Record<string, string>): string =>
  `${url}${url.includes('?') ? '&' : '?'}${new URLSearchParams(query).toString()}`

export function fetchInterviewTransport(endpoints: InterviewEndpoints): InterviewTransport {
  return {
    overview: async (sources) =>
      json<PracticeOverview>(
        await fetch(withQuery(endpoints.overview, { sources: sources.join(',') })),
      ),
    deck: async (sources, topic) =>
      json<PracticeDeck>(
        await fetch(
          withQuery(endpoints.deck, {
            sources: sources.join(','),
            ...(topic === undefined ? {} : { topic: `${topic.source}:${topic.id}` }),
          }),
        ),
      ),
    review: async (request) =>
      json<ReviewResult>(
        await fetch(endpoints.review, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(request),
        }),
      ),
  }
}
