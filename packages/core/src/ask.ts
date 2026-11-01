// One question, one cited answer (SPEC section 9): retrieve, then stream the
// answer with citations, reporting every step as an AnswerEvent (ADR-0006).
// The CLI prints the events; an app route sends them to the browser.
import { NO_CONTEXT, type AnswerEvent, type UsageSummary } from '@docs-rag-lab/contracts'
import type { Effort, PricingSettings } from '@docs-rag-lab/settings'

import {
  buildAnswerRequest,
  CitationNumbering,
  streamAnswer,
  type AnswerClient,
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
  const numbering = new CitationNumbering(retrieval.hits)
  const message = await streamAnswer(
    options.client,
    request,
    {
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
    },
    options.signal,
  )
  onEvent({
    type: 'done',
    stopReason: message.stop_reason,
    usage: usageSummary(meter, options.pricing),
  })
  return retrieval
}
