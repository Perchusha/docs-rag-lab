// The app's routes as plain functions from a Request to a Response, so they are
// tested without Next.js. Each route file is one line that calls one of these
// with the app's engine (apps/CLAUDE.md: routes stay thin).
import {
  encodeEvent,
  NDJSON_CONTENT_TYPE,
  parseRetrievalRequest,
  type AnswerEvent,
  type RetrievalRequest,
} from '@docs-rag-lab/contracts'
import {
  IndexNotFoundError,
  InvalidRequestError,
  MissingKeyError,
  UnknownSourceError,
  UsageMeter,
  type Engine,
} from '@docs-rag-lab/core'

/** The part of the engine the routes use. */
export type RouteEngine = Pick<Engine, 'sources' | 'search' | 'ask' | 'documentChunks'>

/** Builds the engine on first use; a failure there becomes a 500, not a crash. */
export type EngineFactory = () => RouteEngine

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function statusOf(error: unknown): number {
  if (error instanceof InvalidRequestError || error instanceof UnknownSourceError) return 400
  // The index is built by `pnpm drl sync typescript`; until then the app cannot answer.
  if (error instanceof IndexNotFoundError) return 503
  return 500
}

/**
 * An error as JSON. Messages are safe to show: core's errors name a key but
 * never its value (ADR-0007), and this app listens on 127.0.0.1 only.
 */
export function errorResponse(error: unknown): Response {
  const status = statusOf(error)
  if (status === 500 && !(error instanceof MissingKeyError)) console.error(error)
  return Response.json({ error: messageOf(error) }, { status })
}

async function requestOf(request: Request): Promise<RetrievalRequest | Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'the body must be JSON' }, { status: 400 })
  }
  const parsed = parseRetrievalRequest(body)
  return parsed.ok ? parsed.value : Response.json({ error: parsed.error }, { status: 400 })
}

/** POST /api/search: the retrieval trace, no Claude call. */
export async function handleSearch(engine: EngineFactory, request: Request): Promise<Response> {
  const parsed = await requestOf(request)
  if (parsed instanceof Response) return parsed
  try {
    const { trace } = await engine().search(parsed, new UsageMeter())
    return Response.json(trace, { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * POST /api/ask: the answer as an NDJSON stream of AnswerEvents (ADR-0006).
 * The response waits for the first event, so a request the engine refuses
 * (bad field, unknown source, no index, no key) still gets a status code.
 * After that, a failure is sent as an `error` event. When the browser goes
 * away, the request's signal stops the Claude stream.
 */
export async function handleAsk(engine: EngineFactory, request: Request): Promise<Response> {
  const parsed = await requestOf(request)
  if (parsed instanceof Response) return parsed

  const encoder = new TextEncoder()
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined
  let open = true
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c
    },
    cancel() {
      open = false
    },
  })
  const close = () => {
    if (!open) return
    open = false
    controller?.close()
  }

  const first = Promise.withResolvers<undefined>()
  let started = false
  const send = (event: AnswerEvent) => {
    if (!started) {
      started = true
      first.resolve(undefined)
    }
    if (open) controller?.enqueue(encoder.encode(encodeEvent(event)))
  }

  let ask: Promise<unknown>
  try {
    ask = engine().ask(parsed, { meter: new UsageMeter(), onEvent: send, signal: request.signal })
  } catch (error) {
    return errorResponse(error)
  }
  void ask.then(
    () => {
      first.resolve(undefined)
      close()
    },
    (error: unknown) => {
      if (!started) {
        first.reject(error)
        return
      }
      if (!request.signal.aborted) send({ type: 'error', message: messageOf(error) })
      close()
    },
  )

  try {
    await first.promise
  } catch (error) {
    return errorResponse(error)
  }
  return new Response(body, {
    headers: { 'content-type': NDJSON_CONTENT_TYPE, 'cache-control': 'no-store' },
  })
}

/** GET /api/documents?source=&path=: a document's chunks in order, for the inspector. */
export function handleDocument(engine: EngineFactory, request: Request): Response {
  const params = new URL(request.url).searchParams
  const path = params.get('path')
  if (path === null || path === '') {
    return Response.json({ error: 'path is required' }, { status: 400 })
  }
  try {
    const app = engine()
    const source = params.get('source') ?? app.sources[0]?.id ?? ''
    const document = app.documentChunks(source, path)
    if (document === undefined) {
      return Response.json({ error: `${path} is not in the ${source} index` }, { status: 404 })
    }
    return Response.json(document)
  } catch (error) {
    return errorResponse(error)
  }
}
