// Request bodies from the browser (ADR-0006). The app's routes parse them with
// these before anything reaches the engine. They check the shape only; the
// engine still checks the values it alone knows, such as doc types and the
// top K range. Written by hand, because contracts imports no library.
import type { RetrievalRequest } from './answer.ts'
import { STRATEGIES, type Strategy } from './trace.ts'

/** The longest question a route accepts, in characters. */
export const MAX_QUESTION_LENGTH = 2000

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }

const FIELDS: ReadonlySet<string> = new Set(['question', 'source', 'strategy', 'docTypes', 'topK'])

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error }
}

/** A JSON body as a RetrievalRequest, or why it is not one. Unknown fields are refused. */
export function parseRetrievalRequest(body: unknown): Parsed<RetrievalRequest> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return fail('the body must be a JSON object')
  }
  const fields: Record<string, unknown> = { ...body }
  const unknown = Object.keys(fields).filter((key) => !FIELDS.has(key))
  if (unknown.length > 0) return fail(`unknown field "${unknown.join('", "')}"`)

  const { question, source, strategy, docTypes, topK } = fields
  if (typeof question !== 'string' || question.trim() === '') {
    return fail('question must be a non-empty string')
  }
  if (question.length > MAX_QUESTION_LENGTH) {
    return fail(`question must be at most ${String(MAX_QUESTION_LENGTH)} characters`)
  }
  const request: RetrievalRequest = { question }

  if (source !== undefined) {
    if (typeof source !== 'string' || source === '') return fail('source must be a string')
    request.source = source
  }
  if (strategy !== undefined) {
    const known = STRATEGIES.find((s): s is Strategy => s === strategy)
    if (known === undefined) return fail(`strategy must be one of ${STRATEGIES.join(', ')}`)
    request.strategy = known
  }
  if (docTypes !== undefined) {
    if (!Array.isArray(docTypes) || !docTypes.every((t): t is string => typeof t === 'string')) {
      return fail('docTypes must be an array of strings')
    }
    request.docTypes = docTypes
  }
  if (topK !== undefined) {
    if (typeof topK !== 'number' || !Number.isInteger(topK)) {
      return fail('topK must be a whole number')
    }
    request.topK = topK
  }
  return { ok: true, value: request }
}
