// How ui talks to the app (ADR-0008). The app passes its route URLs as
// endpoints, and fetchTransport calls them. Stories and tests pass their own
// Transport instead, which replays recorded data.
import {
  EventDecoder,
  type AnswerEvent,
  type DocumentChunks,
  type RetrievalRequest,
  type RetrievalTrace,
} from '@docs-rag-lab/contracts'

export interface Endpoints {
  /** POST a RetrievalRequest; the response is an NDJSON stream of AnswerEvents. */
  ask: string
  /** POST a RetrievalRequest; the response is the RetrievalTrace. No Claude call. */
  search: string
  /** GET with ?source=&path=; the response is the DocumentChunks. */
  documents: string
}

export interface Transport {
  ask(request: RetrievalRequest, signal: AbortSignal): AsyncIterable<AnswerEvent>
  search(request: RetrievalRequest, signal: AbortSignal): Promise<RetrievalTrace>
  document(source: string, path: string, signal: AbortSignal): Promise<DocumentChunks>
}

/** Reads an NDJSON body as answer events, as they arrive. */
export async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<AnswerEvent> {
  const reader = body.getReader()
  // stream: true keeps a multi-byte character split across reads for the next one.
  const text = new TextDecoder()
  const decoder = new EventDecoder()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      yield* decoder.push(text.decode(value, { stream: true }))
    }
    yield* decoder.push(text.decode())
    yield* decoder.end()
  } finally {
    reader.releaseLock()
  }
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

const JSON_HEADERS = { 'content-type': 'application/json' }

export function fetchTransport(endpoints: Endpoints, fetchFn: typeof fetch = fetch): Transport {
  return {
    async *ask(request, signal) {
      const response = await fetchFn(endpoints.ask, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(request),
        signal,
      })
      if (!response.ok) throw await failure(response)
      if (response.body === null) throw new Error('the answer stream has no body')
      yield* readEvents(response.body)
    },

    async search(request, signal) {
      const response = await fetchFn(endpoints.search, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(request),
        signal,
      })
      if (!response.ok) throw await failure(response)
      return (await response.json()) as RetrievalTrace
    },

    async document(source, path, signal) {
      const query = new URLSearchParams({ source, path })
      const response = await fetchFn(`${endpoints.documents}?${query.toString()}`, { signal })
      if (!response.ok) throw await failure(response)
      return (await response.json()) as DocumentChunks
    },
  }
}
