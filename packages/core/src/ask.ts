// One question, one cited answer (SPEC section 9): retrieve, then stream the
// answer with citations, reporting every step as an AnswerEvent (ADR-0006).
// The CLI prints the events; an app route sends them to the browser.
import type Anthropic from '@anthropic-ai/sdk'
import {
  NO_CONTEXT,
  type AnswerEvent,
  type EvalAgentSearch,
  type UsageSummary,
} from '@docs-rag-lab/contracts'
import type { SearchHit } from '@docs-rag-lab/db'
import type { Effort, PricingSettings } from '@docs-rag-lab/settings'

import { buildAgentRequest, runAgentLoop, type AgentSearchFn } from './agent.ts'
import {
  buildAnswerRequest,
  CitationNumbering,
  streamAnswer,
  type AnswerClient,
  type StreamHandlers,
} from './generate.ts'
import { retrieve, type Retrieval, type RetrieveOptions } from './retrieve.ts'
import type { UsageMeter } from './usage.ts'

export interface AskOptions extends RetrieveOptions {
  client: AnswerClient
  model: string
  effort: Effort
  maxTokens: number
  pricing: PricingSettings
  onEvent: (event: AnswerEvent) => void
  /** Stops the Claude stream, for example when the browser goes away. */
  signal?: AbortSignal | undefined
}

/** What the meter has recorded so far, with the estimated cost. */
export function usageSummary(meter: UsageMeter, pricing: PricingSettings): UsageSummary {
  const cost = meter.estimateCost(pricing)
  return {
    models: meter.entries().map(([model, u]) => ({
      model,
      kind: u.kind,
      requests: u.requests,
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      cacheWriteTokens: u.cacheWriteTokens,
      cacheReadTokens: u.cacheReadTokens,
      cacheHits: u.cacheHits,
    })),
    costUsd: cost.total,
    pricesChecked: pricing.checked,
    unpriced: cost.unpriced,
  }
}

/**
 * Answers a question from the docs. Events arrive in order: one `trace`, then
 * `text` and `citations` while the answer streams, then `done`. Failures are
 * thrown, not sent as events: the caller owns the transport and decides how to
 * report them. Usage goes to the caller's meter as it happens, also on failure.
 */
export async function ask(options: AskOptions): Promise<Retrieval> {
  const { onEvent, meter, model } = options
  const retrieval = await retrieve(options)
  onEvent({ type: 'trace', trace: retrieval.trace })
  if (retrieval.hits.length === 0) {
    onEvent({ type: 'done', stopReason: NO_CONTEXT, usage: usageSummary(meter, options.pricing) })
    return retrieval
  }

  const request = buildAnswerRequest({
    question: options.question,
    hits: retrieval.hits,
    model,
    effort: options.effort,
    maxTokens: options.maxTokens,
  })
  const message = await streamAnswer(
    options.client,
    request,
    streamHandlers(options, new CitationNumbering(retrieval.hits)),
    options.signal,
  )
  onEvent({
    type: 'done',
    stopReason: message.stop_reason,
    usage: usageSummary(meter, options.pricing),
  })
  return retrieval
}

/** Text and citations as events, and usage on the meter, as an answer streams. */
function streamHandlers(options: AskOptions, numbering: CitationNumbering): StreamHandlers {
  const { onEvent, meter, model } = options
  return {
    onText: (text) => {
      onEvent({ type: 'text', text })
    },
    onTextBlock: (block) => {
      const known = numbering.list().length
      const numbers = numbering.add(block)
      if (numbers.length === 0) return
      onEvent({ type: 'citations', numbers, citations: numbering.list().slice(known) })
    },
    onUsage: (usage) => {
      meter.recordMessage(model, usage)
    },
  }
}

export interface AgenticAskOptions extends AskOptions {
  /** The doc types the source's index holds, which search_docs can filter by. */
  toolDocTypes: readonly string[]
  maxSearches: number
  /** A search of Claude's own. */
  search: AgentSearchFn
  onSearch?: ((search: EvalAgentSearch, hits: readonly SearchHit[]) => void) | undefined
}

/**
 * Agentic mode (ADR-0019): the same first search as ask(), then Claude may search again. Events
 * are ask()'s, and each search of Claude's own goes to `onSearch`. Citations are numbered over
 * every chunk of the conversation, as the API numbers its search results. A loop that fails is
 * thrown, as any failure is.
 */
export async function askAgentic(options: AgenticAskOptions): Promise<Retrieval> {
  const { onEvent, meter, model } = options
  const retrieval = await retrieve(options)
  onEvent({ type: 'trace', trace: retrieval.trace })
  if (retrieval.hits.length === 0) {
    onEvent({ type: 'done', stopReason: NO_CONTEXT, usage: usageSummary(meter, options.pricing) })
    return retrieval
  }
  const first = buildAgentRequest({
    question: options.question,
    hits: retrieval.hits,
    model,
    effort: options.effort,
    maxTokens: options.maxTokens,
    docTypes: options.toolDocTypes,
  })
  let numbering: CitationNumbering | undefined
  const loop = await runAgentLoop({
    first,
    hits: retrieval.hits,
    docTypes: options.toolDocTypes,
    maxSearches: options.maxSearches,
    search: options.search,
    ...(options.onSearch === undefined ? {} : { onSearch: options.onSearch }),
    call: (request: Anthropic.MessageCreateParamsNonStreaming, _step, context) => {
      // The loop's own list, which grows with each search, so later citations find their chunk.
      numbering ??= new CitationNumbering(context)
      return streamAnswer(
        options.client,
        request,
        streamHandlers(options, numbering),
        options.signal,
      )
    },
  })
  if (loop.failure !== undefined) throw new Error(`the agentic answer failed: ${loop.failure}`)
  onEvent({
    type: 'done',
    stopReason: loop.message.stop_reason,
    usage: usageSummary(meter, options.pricing),
  })
  return retrieval
}
