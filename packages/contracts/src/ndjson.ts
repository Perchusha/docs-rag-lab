// The answer stream on the wire (ADR-0006): newline-delimited JSON, one
// AnswerEvent per line. An app route encodes the events ask() reports, and ui
// decodes them as they arrive. Plain string code with no stream API, so the
// same file runs in Node and in the browser.
import type { AnswerEvent } from './answer.ts'

/** The media type of an answer stream. */
export const NDJSON_CONTENT_TYPE = 'application/x-ndjson; charset=utf-8'

const EVENT_TYPES: ReadonlySet<string> = new Set<AnswerEvent['type']>([
  'trace',
  'text',
  'citations',
  'done',
  'error',
])

/** A line of the stream is not an answer event. */
export class StreamFormatError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'StreamFormatError'
  }
}

/** One event as one line, newline included. */
export function encodeEvent(event: AnswerEvent): string {
  return `${JSON.stringify(event)}\n`
}

/**
 * Parses one line. Checks only that it is a JSON object with a known `type`:
 * the stream comes from the app's own route, which encodes typed events.
 */
export function parseEvent(line: string): AnswerEvent {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch (error) {
    throw new StreamFormatError(`not a JSON line: ${line.slice(0, 80)}`, { cause: error })
  }
  if (
    typeof value !== 'object' ||
    value === null ||
    !('type' in value) ||
    typeof value.type !== 'string' ||
    !EVENT_TYPES.has(value.type)
  ) {
    throw new StreamFormatError(`not an answer event: ${line.slice(0, 80)}`)
  }
  return value as AnswerEvent
}

/**
 * Turns decoded text into events. Text arrives in pieces that may end in the
 * middle of a line; a line becomes an event once its newline arrives.
 */
export class EventDecoder {
  #pending = ''

  /** The events that this piece of text completes. */
  push(text: string): AnswerEvent[] {
    const lines = (this.#pending + text).split('\n')
    this.#pending = lines.pop() ?? ''
    return lines.filter((line) => line.trim() !== '').map(parseEvent)
  }

  /** Call once the stream has ended. A last line without its newline still counts. */
  end(): AnswerEvent[] {
    const rest = this.#pending
    this.#pending = ''
    return rest.trim() === '' ? [] : [parseEvent(rest)]
  }
}
