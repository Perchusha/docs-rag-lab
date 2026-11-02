// A Transport that replays recorded data, for stories and tests: no network,
// and no app server. Not part of the public entry.
import type {
  AnswerEvent,
  DocumentChunks,
  RetrievalRequest,
  RetrievalTrace,
} from '@docs-rag-lab/contracts'

import type { Transport } from './transport.ts'

/**
 * Lets a test decide when a replay moves on. A gated step waits for a release,
 * however slow the machine is, so a test can check a state that lasts
 * milliseconds in real use: it holds until the test lets it go. A story that
 * checks anything but the final state uses a gate, never a timer.
 */
export interface ReplayGate {
  /** Lets this many steps through, whether they wait already or come later. */
  release: (count?: number) => void
  /** Lets every step through from now on. */
  open: () => void
  /** Closed again, with nothing released. A story calls it first, so it can run twice. */
  reset: () => void
  /** Resolves when a step may go on. */
  pass: () => Promise<void>
}

export function replayGate(): ReplayGate {
  let released = 0
  let opened = false
  let waiting: (() => void)[] = []
  const flush = () => {
    while (waiting.length > 0 && (opened || released > 0)) {
      if (!opened) released -= 1
      waiting.shift()?.()
    }
  }
  return {
    release(count = 1) {
      released += count
      flush()
    },
    open() {
      opened = true
      flush()
    },
    reset() {
      released = 0
      opened = false
      waiting = []
    },
    pass() {
      return new Promise((resolve) => {
        waiting.push(resolve)
        flush()
      })
    },
  }
}

export interface ReplayOptions {
  /** What ask() streams. */
  events?: readonly AnswerEvent[]
  /** What search() returns; defaults to the trace event in `events`. */
  trace?: RetrievalTrace
  documents?: readonly DocumentChunks[]
  /** The wait before each event and response, for watching a story stream. */
  delayMs?: number
  /** Each ask() event waits for this gate instead of delayMs. */
  gate?: ReplayGate
  /** search() waits for this gate instead of delayMs. */
  searchGate?: ReplayGate
  /**
   * ask() keeps sending after its signal aborts, as a response does with
   * the events of a chunk it has already read.
   */
  ignoresAbort?: boolean
  /** Every call fails with this message instead. */
  failure?: string
  /** Called with each request, so a story can check what the form sent. */
  onRequest?: (kind: 'ask' | 'search', request: RetrievalRequest) => void
  /** Called when an ask() ends, with whether its signal had aborted by then. */
  onAskEnd?: (outcome: 'finished' | 'aborted') => void
}

function abortable(wait: Promise<void>, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason as Error)
      return
    }
    signal.addEventListener(
      'abort',
      () => {
        reject(signal.reason as Error)
      },
      { once: true },
    )
    void wait.then(resolve)
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function replayTransport(options: ReplayOptions): Transport {
  const { events = [], documents = [], delayMs = 0, gate, searchGate } = options
  const trace =
    options.trace ?? events.flatMap((event) => (event.type === 'trace' ? [event.trace] : [])).at(0)

  return {
    async *ask(request, signal) {
      options.onRequest?.('ask', request)
      try {
        for (const event of events) {
          const step = gate?.pass() ?? sleep(delayMs)
          await (options.ignoresAbort === true ? step : abortable(step, signal))
          if (options.failure !== undefined) throw new Error(options.failure)
          yield event
        }
      } finally {
        options.onAskEnd?.(signal.aborted ? 'aborted' : 'finished')
      }
    },

    async search(request, signal) {
      options.onRequest?.('search', request)
      await abortable(searchGate?.pass() ?? sleep(delayMs), signal)
      if (options.failure !== undefined) throw new Error(options.failure)
      if (trace === undefined) throw new Error('nothing to replay: no trace')
      return trace
    },

    async document(_source, path, signal) {
      await abortable(sleep(delayMs), signal)
      const document = documents.find((d) => d.path === path)
      if (document === undefined) throw new Error(`no recorded document ${path}`)
      return document
    },
  }
}
