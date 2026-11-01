// A question in, a cited answer out (ADR-0006). The engine reports an answer
// as a sequence of events, so the CLI can print it as it streams and an app
// route can send it to the browser as NDJSON, one event per line.
import type { RetrievalTrace, Strategy } from './trace.ts'

/** What to retrieve for. Anything left out comes from the engine settings. */
export interface RetrievalRequest {
  question: string
  /** A configured source ID; the first configured source when missing. */
  source?: string
  strategy?: Strategy
  /** Only chunks of these doc types; empty or missing means all. */
  docTypes?: string[]
  /** Chunks that go to the answer. */
  topK?: number
}

/** One cited source of an answer, numbered in order of first use. */
export interface Citation {
  /** 1-based. */
  number: number
  /** The doc URL with the section anchor. */
  source: string
  title: string
  /** The passage Claude cited. */
  citedText: string
  /** The context chunk the citation points to, so the inspector can select it. */
  chunkId: string
  /** That chunk's 1-based rank in the context. */
  contextRank: number
}

/** What one model used while answering. */
export interface ModelUsageSummary {
  model: string
  kind: 'embedding' | 'messages'
  requests: number
  inputTokens: number
  outputTokens: number
  cacheWriteTokens: number
  cacheReadTokens: number
  /** Embedding inputs served from the local cache. */
  cacheHits: number
}

export interface UsageSummary {
  models: ModelUsageSummary[]
  /** Estimated at list prices. */
  costUsd: number
  /** When the prices were checked. */
  pricesChecked: string
  /** Models that were used but have no price. */
  unpriced: string[]
}

/** The engine's own stop reason when retrieval found nothing to answer from. */
export const NO_CONTEXT = 'no_context'

export type AnswerEvent =
  /** First: how the context was chosen. */
  | { type: 'trace'; trace: RetrievalTrace }
  /** A piece of the answer text, as it streams. */
  | { type: 'text'; text: string }
  /**
   * A text block with citations has ended. `numbers` are its markers, in order;
   * `citations` are the sources numbered for the first time in it.
   */
  | { type: 'citations'; numbers: number[]; citations: Citation[] }
  /** Last, on success. `stopReason` is Claude's, or NO_CONTEXT. */
  | { type: 'done'; stopReason: string | null; usage: UsageSummary }
  /** Last, on failure. The message never contains a secret. */
  | { type: 'error'; message: string }
