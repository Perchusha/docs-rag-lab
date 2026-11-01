import { encodeEvent, type AnswerEvent } from '@docs-rag-lab/contracts'
import { describe, expect, it } from 'vitest'

import { answerFixture, documentFixture, traces } from '../fixtures.ts'
import { fetchTransport, readEvents } from './transport.ts'

const endpoints = { ask: '/api/ask', search: '/api/search', documents: '/api/documents' }

/** A body that sends the bytes in small pieces, splitting multi-byte characters. */
function chunkedBody(text: string, size: number): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text)
  let at = 0
  return new ReadableStream({
    pull(controller) {
      if (at >= bytes.length) controller.close()
      else controller.enqueue(bytes.slice(at, (at += size)))
    },
  })
}

interface Call {
  url: string
  init: RequestInit | undefined
}

function fakeFetch(respond: (url: string) => Response) {
  const calls: Call[] = []
  const fetchFn: typeof fetch = (input, init) => {
    const url = input instanceof Request ? input.url : String(input)
    calls.push({ url, init })
    return Promise.resolve(respond(url))
  }
  return { calls, fetchFn }
}

async function collect(events: AsyncIterable<AnswerEvent>): Promise<AnswerEvent[]> {
  const all: AnswerEvent[] = []
  for await (const event of events) all.push(event)
  return all
}

describe('readEvents', () => {
  it('decodes the recorded stream sent 5 bytes at a time', async () => {
    const russian: AnswerEvent = { type: 'text', text: 'В чём разница' }
    const wire = [...answerFixture.events, russian].map(encodeEvent).join('')
    const events = await collect(readEvents(chunkedBody(wire, 5)))
    expect(events).toEqual([...answerFixture.events, russian])
  })
})

describe('fetchTransport', () => {
  it('posts the request to the ask endpoint and streams the events', async () => {
    const wire = answerFixture.events.map(encodeEvent).join('')
    const { calls, fetchFn } = fakeFetch(() => new Response(chunkedBody(wire, 64)))
    const signal = new AbortController().signal
    const transport = fetchTransport(endpoints, fetchFn)
    const events = await collect(transport.ask({ question: 'q', strategy: 'vector' }, signal))
    expect(events.map((e) => e.type).at(-1)).toBe('done')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('/api/ask')
    expect(calls[0]?.init?.method).toBe('POST')
    expect(calls[0]?.init?.body).toBe('{"question":"q","strategy":"vector"}')
    expect(calls[0]?.init?.signal).toBe(signal)
  })

  it('returns the trace from search and the document from documents', async () => {
    const { calls, fetchFn } = fakeFetch((url) =>
      Response.json(url.startsWith('/api/search') ? traces.satisfies : documentFixture),
    )
    const transport = fetchTransport(endpoints, fetchFn)
    const signal = new AbortController().signal
    expect(await transport.search({ question: 'q' }, signal)).toEqual(traces.satisfies)
    expect(await transport.document('typescript', 'a b/c#.md', signal)).toEqual(documentFixture)
    expect(calls[1]?.url).toBe('/api/documents?source=typescript&path=a+b%2Fc%23.md')
  })

  it("throws the route's error message, or the status line", async () => {
    const signal = new AbortController().signal
    const json = fetchTransport(
      endpoints,
      fakeFetch(() =>
        Response.json({ error: 'question must be a non-empty string' }, { status: 400 }),
      ).fetchFn,
    )
    await expect(json.search({ question: '' }, signal)).rejects.toThrow(
      'question must be a non-empty string',
    )
    const html = fetchTransport(
      endpoints,
      fakeFetch(() => new Response('<html>', { status: 502, statusText: 'Bad Gateway' })).fetchFn,
    )
    await expect(collect(html.ask({ question: 'q' }, signal))).rejects.toThrow('502 Bad Gateway')
  })
})
