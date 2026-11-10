// One question, one cited answer (SPEC section 9): retrieve, then stream the
// answer with citations, reporting every step as an AnswerEvent (ADR-0006).
// The CLI prints the events; an app route sends them to the browser.
import type Anthropic from '@anthropic-ai/sdk'
import { NO_CONTEXT, type AnswerEvent, type UsageSummary } from '@docs-rag-lab/contracts'
import type { Effort, PricingSettings } from '@docs-rag-lab/settings'

import { buildAgentRequest, checkCitations, runAgentLoop } from './agent.ts'
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
 * `text` and `citations` while the answer streams, then `done`. A `wait` for the
 * embedding rate limit may come before the trace (ADR-0019). Failures are
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
  /** A search of Claude's own, with its trace. */
  search: (query: string, docTypes: readonly string[]) => Promise<Retrieval>
}

/**
 * Agentic mode (ADR-0019): the same first search as ask(), then Claude may search again. Events
 * are ask()'s, and each search of Claude's own sends `search` as it begins and `searched` with its
 * trace as it ends, so a page can show each step as it happens. Citations are numbered over
 * every chunk of the conversation, as the API numbers its search results, and checked against it.
 * Only the answer's own step reaches the events, as only it is scored in eval: a step that asks
 * for a search keeps whatever text it had to itself. So the answer arrives when its step ends. A
 * loop that fails is thrown, as any failure is.
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
  let lastTrace = retrieval.trace
  const loop = await runAgentLoop({
    first,
    hits: retrieval.hits,
    docTypes: options.toolDocTypes,
    maxSearches: options.maxSearches,
    signal: options.signal,
    search: async (query, docTypes) => {
      const found = await options.search(query, docTypes)
      lastTrace = found.trace
      return found.hits
    },
    onSearchStart: (query, docTypes) => {
      onEvent({ type: 'search', query, docTypes: [...docTypes] })
    },
    onSearch: (search) => {
      onEvent({
        type: 'searched',
        found: search.chunkIds.length,
        alreadyShown: search.alreadyShown,
        trace: lastTrace,
      })
    },
    call: async (request: Anthropic.MessageCreateParamsNonStreaming, _step, context) => {
      // The loop's own list, which grows with each search, so later citations find their chunk.
      numbering ??= new CitationNumbering(context)
      const held: (() => void)[] = []
      const handlers = streamHandlers(options, numbering)
      const message = await streamAnswer(
        options.client,
        request,
        {
          onText: (text) => held.push(() => handlers.onText?.(text)),
          onTextBlock: (block) => held.push(() => handlers.onTextBlock?.(block)),
          onUsage: handlers.onUsage,
        },
        options.signal,
      )
      checkCitations(message, context)
      if (message.stop_reason !== 'tool_use') for (const send of held) send()
      return message
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
