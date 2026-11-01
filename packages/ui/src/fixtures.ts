// Typed access to the recorded fixtures in __fixtures__, for unit tests and
// stories. Not part of the public entry. The traces come from
// `drl search --json` over the real index; the answer is one real
// `ask` stream. Every excerpt of the docs is cut to 300 characters (NOTICE).
import {
  EventDecoder,
  type AnswerEvent,
  type Citation,
  type DocumentChunks,
  type RetrievalTrace,
  type UsageSummary,
} from '@docs-rag-lab/contracts'

import answerNdjson from './__fixtures__/answer-satisfies.ndjson?raw'
import documentTs49 from './__fixtures__/document-ts-4-9.json'
import satisfiesVector from './__fixtures__/trace-satisfies-vector.json'
import satisfies from './__fixtures__/trace-satisfies.json'
import ts0004 from './__fixtures__/trace-ts-0004.json'
import ts2345 from './__fixtures__/trace-ts2345.json'
import { appendCitations, appendText, type AnswerPart } from './lib/answer.ts'

export const traces = {
  /** "In which version did `satisfies` appear?": BM25 counts `satisfies` twice. */
  satisfies: satisfies as RetrievalTrace,
  /** The same question with vector search only. */
  satisfiesVector: satisfiesVector as RetrievalTrace,
  /** "What does error TS2345 mean?": the exact list rescues the error code. */
  ts2345: ts2345 as RetrievalTrace,
  /** ts-0004, a Russian question about `unknown` and `any`. */
  ts0004: ts0004 as RetrievalTrace,
}

/** The chunks of TypeScript 4.9.md, where two `satisfies` candidates live. */
export const documentFixture = documentTs49 as DocumentChunks

function decode(ndjson: string): AnswerEvent[] {
  const decoder = new EventDecoder()
  return [...decoder.push(ndjson), ...decoder.end()]
}

const events = decode(answerNdjson)

function summarize(all: readonly AnswerEvent[]) {
  let parts: AnswerPart[] = []
  const citations: Citation[] = []
  let usage: UsageSummary | undefined
  for (const event of all) {
    if (event.type === 'text') parts = appendText(parts, event.text)
    else if (event.type === 'citations') {
      parts = appendCitations(parts, event.numbers)
      citations.push(...event.citations)
    } else if (event.type === 'done') usage = event.usage
  }
  if (usage === undefined) throw new Error('the answer fixture has no done event')
  return { parts, citations, usage }
}

/** The recorded answer to the `satisfies` question: its events, and what they add up to. */
export const answerFixture = { events, ...summarize(events) }
