import {
  EventDecoder,
  TRACE_VERSION,
  type AnswerEvent,
  type DocumentChunks,
  type RetrievalTrace,
} from '@docs-rag-lab/contracts'
import {
  IndexNotFoundError,
  InvalidRequestError,
  MissingKeyError,
  UnknownSourceError,
  type Retrieval,
} from '@docs-rag-lab/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { handleAsk, handleDocument, handleSearch, type RouteEngine } from './handlers.ts'

const trace: RetrievalTrace = {
  version: TRACE_VERSION,
  question: 'q',
  sourceId: 'typescript',
  strategy: 'hybrid',
  params: { topK: 8, candidates: 50, rrfK: 60 },
  filters: { docTypes: [] },
  query: { terms: [], exactTokens: [] },
  embedding: { provider: 'fake', from: 'cache', ms: 0 },
  lists: [],
  fusion: { method: 'none' },
  chunks: {},
  context: [],
  totalMs: 1,
}

const retrieval: Retrieval = { hits: [], trace }

const usage = { models: [], costUsd: 0, pricesChecked: '2026-10-31', unpriced: [] }

const document: DocumentChunks = {
  sourceId: 'typescript',
  path: 'a.md',
  url: 'https://example.com/a',
  title: 'A',
  docType: 'handbook',
  chunks: [],
}

function engineWith(overrides: Partial<RouteEngine>) {
  const engine: RouteEngine = {
    sources: [{ id: 'typescript' } as RouteEngine['sources'][number]],
    search: vi.fn(() => Promise.resolve(retrieval)),
    ask: vi.fn(() => Promise.resolve(retrieval)),
    documentChunks: vi.fn(() => document),
    ...overrides,
  }
  return { engine, factory: () => engine }
}

function post(path: string, body: unknown, signal?: AbortSignal): Request {
  return new Request(`http://127.0.0.1:3000${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    ...(signal === undefined ? {} : { signal }),
  })
}

async function eventsOf(response: Response): Promise<AnswerEvent[]> {
  const decoder = new EventDecoder()
  return [...decoder.push(await response.text()), ...decoder.end()]
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('handleSearch', () => {
  it('returns the trace for a valid request', async () => {
    const { engine, factory } = engineWith({})
    const response = await handleSearch(
      factory,
      post('/api/search', { question: 'q', strategy: 'vector', docTypes: ['option'] }),
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(trace)
    expect(engine.search).toHaveBeenCalledWith(
      { question: 'q', strategy: 'vector', docTypes: ['option'] },
      expect.anything(),
    )
  })

  it.each([
    ['not json', 'the body must be JSON'],
    [{ question: '' }, 'question must be a non-empty string'],
    [{ question: 'q', model: 'claude-opus' }, 'unknown field "model"'],
  ])('refuses %j with 400 before the engine runs', async (body, error) => {
    const { engine, factory } = engineWith({})
    const response = await handleSearch(factory, post('/api/search', body))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error })
    expect(engine.search).not.toHaveBeenCalled()
  })

  it.each([
    [new InvalidRequestError('unknown doc type "nope"'), 400],
    [new UnknownSourceError('react', []), 400],
    [new IndexNotFoundError('typescript'), 503],
    [new MissingKeyError('VOYAGE_API_KEY is not set.'), 500],
  ])('maps %s to %i with its message', async (error, status) => {
    const { factory } = engineWith({ search: () => Promise.reject(error) })
    const response = await handleSearch(factory, post('/api/search', { question: 'q' }))
    expect(response.status).toBe(status)
    expect(await response.json()).toEqual({ error: error.message })
  })

  it('logs an unexpected error and returns 500', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const response = await handleSearch(
      () => {
        throw new Error('no pnpm-workspace.yaml above /')
      },
      post('/api/search', { question: 'q' }),
    )
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'no pnpm-workspace.yaml above /' })
    expect(log).toHaveBeenCalledOnce()
  })
})

describe('handleAsk', () => {
  it('streams the events as NDJSON, in order', async () => {
    const events: AnswerEvent[] = [
      { type: 'trace', trace },
      { type: 'text', text: 'In 4.9' },
      { type: 'done', stopReason: 'end_turn', usage },
    ]
    const { factory } = engineWith({
      ask: (_request, run) => {
        for (const event of events) run.onEvent(event)
        return Promise.resolve(retrieval)
      },
    })
    const response = await handleAsk(factory, post('/api/ask', { question: 'q' }))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/x-ndjson; charset=utf-8')
    expect(await eventsOf(response)).toEqual(events)
  })

  it('answers with a status code when the engine refuses before the first event', async () => {
    const { factory } = engineWith({
      ask: () => Promise.reject(new IndexNotFoundError('typescript')),
    })
    const response = await handleAsk(factory, post('/api/ask', { question: 'q' }))
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      error: 'there is no index for typescript yet: run drl sync typescript first',
    })
  })

  it('ends the stream with an error event when the answer fails part-way', async () => {
    const { factory } = engineWith({
      ask: async (_request, run) => {
        run.onEvent({ type: 'trace', trace })
        await Promise.resolve()
        throw new Error('connection reset')
      },
    })
    const response = await handleAsk(factory, post('/api/ask', { question: 'q' }))
    expect(response.status).toBe(200)
    expect(await eventsOf(response)).toEqual([
      { type: 'trace', trace },
      { type: 'error', message: 'connection reset' },
    ])
  })

  it("passes the request's signal, and sends no error once the browser has gone", async () => {
    const browser = new AbortController()
    let seen: AbortSignal | undefined
    const { factory } = engineWith({
      ask: (_request, run) => {
        seen = run.signal
        run.onEvent({ type: 'trace', trace })
        return new Promise((_resolve, reject) => {
          run.signal?.addEventListener('abort', () => {
            reject(new Error('Request was aborted.'))
          })
        })
      },
    })
    const response = await handleAsk(factory, post('/api/ask', { question: 'q' }, browser.signal))
    expect(seen?.aborted).toBe(false)
    browser.abort()
    expect(seen?.aborted).toBe(true)
    expect(await eventsOf(response)).toEqual([{ type: 'trace', trace }])
  })

  it('refuses a bad body with 400', async () => {
    const { engine, factory } = engineWith({})
    const response = await handleAsk(factory, post('/api/ask', { question: 'q', topK: '8' }))
    expect(response.status).toBe(400)
    expect(engine.ask).not.toHaveBeenCalled()
  })
})

describe('handleDocument', () => {
  const get = (query: string) => new Request(`http://127.0.0.1:3000/api/documents${query}`)

  it("returns the document's chunks, from the first source when none is named", () => {
    const { engine, factory } = engineWith({})
    const response = handleDocument(factory, get('?path=a.md'))
    expect(response.status).toBe(200)
    expect(engine.documentChunks).toHaveBeenCalledWith('typescript', 'a.md')
  })

  it('needs a path, and answers 404 for a path that is not indexed', async () => {
    const { factory } = engineWith({ documentChunks: () => undefined })
    expect(handleDocument(factory, get('')).status).toBe(400)
    const missing = handleDocument(factory, get('?source=typescript&path=b.md'))
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({ error: 'b.md is not in the typescript index' })
  })

  it('maps an unknown source to 400', () => {
    const { factory } = engineWith({
      documentChunks: () => {
        throw new UnknownSourceError('react', [])
      },
    })
    expect(handleDocument(factory, get('?source=react&path=a.md')).status).toBe(400)
  })
})
