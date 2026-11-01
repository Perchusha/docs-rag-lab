// A Transport that replays recorded data, for stories and tests: no network,
// and no app server. Not part of the public entry.
import type {
  AnswerEvent,
  DocumentChunks,
  RetrievalRequest,
  RetrievalTrace,
} from '@docs-rag-lab/contracts'

import type { Transport } from './transport.ts'

export interface ReplayOptions {
  /** What ask() streams. */
  events?: readonly AnswerEvent[]
  /** What search() returns; defaults to the trace event in `events`. */
  trace?: RetrievalTrace
  documents?: readonly DocumentChunks[]
  /** The wait before each event and response. */
  delayMs?: number
  /** Every call fails with this message instead. */
  failure?: string
  /** Called with each request, so a story can check what the form sent. */
  onRequest?: (kind: 'ask' | 'search', request: RetrievalRequest) => void
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason as Error)
      return
    }
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(signal.reason as Error)
      },
      { once: true },
    )
  })
}

export function replayTransport(options: ReplayOptions): Transport {
  const { events = [], documents = [], delayMs = 0 } = options
  const trace =
    options.trace ?? events.flatMap((event) => (event.type === 'trace' ? [event.trace] : [])).at(0)

  return {
    async *ask(request, signal) {
      options.onRequest?.('ask', request)
      for (const event of events) {
        await sleep(delayMs, signal)
        if (options.failure !== undefined) throw new Error(options.failure)
        yield event
      }
    },

    async search(request, signal) {
      options.onRequest?.('search', request)
      await sleep(delayMs, signal)
      if (options.failure !== undefined) throw new Error(options.failure)
      if (trace === undefined) throw new Error('nothing to replay: no trace')
      return trace
    },

    async document(_source, path, signal) {
      await sleep(delayMs, signal)
      const document = documents.find((d) => d.path === path)
      if (document === undefined) throw new Error(`no recorded document ${path}`)
      return document
    },
  }
}
