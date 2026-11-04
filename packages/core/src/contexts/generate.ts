// One context per chunk, Anthropic's Contextual Retrieval (ADR-0014). The whole document is
// sent with each of its chunks, under prompt caching: the first request for a document finishes
// before the others start, since a cache entry only exists once a response has begun. The
// contexts are for retrieval only: Claude's answers get the chunk, never this text.
import type Anthropic from '@anthropic-ai/sdk'
import type { ContextualizeSettings, PricingSettings } from '@docs-rag-lab/settings'
import { estimateTokens } from '@docs-rag-lab/source-kit'

import { forEachLimit, promptHash } from '../eval/answers.ts'
import type { AnswerClient } from '../generate.ts'
import type { ModelUsage, UsageMeter } from '../usage.ts'
import type { StoredContext } from './store.ts'

export interface ContextChunk {
  id: string
  text: string
  textHash: string
  /** The section the chunk starts in. */
  sectionPath: readonly string[]
}

export interface ContextDocument {
  path: string
  title: string
  chunks: readonly ContextChunk[]
}

/** The repository holds no em dash in any text (CLAUDE.md), and these lines are committed. */
const EM_DASH = new RegExp(String.fromCodePoint(0x2014), 'g')

function documentTextOf(document: ContextDocument): string {
  return document.chunks.map((chunk) => chunk.text).join('\n\n')
}

/** The prompt from Anthropic's write-up, with the document in a block of its own to cache. */
function contextRequest(
  model: string,
  settings: Pick<ContextualizeSettings, 'effort' | 'maxTokens'>,
  document: string,
  chunk: string,
  cache: boolean,
): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model,
    max_tokens: settings.maxTokens,
    thinking: { type: 'disabled' },
    output_config: { effort: settings.effort },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `<document>\n${document}\n</document>`,
            ...(cache ? { cache_control: { type: 'ephemeral' as const } } : {}),
          },
          {
            type: 'text',
            text: `Here is the chunk we want to situate within the whole document\n<chunk>\n${chunk}\n</chunk>\nPlease give a short succinct context to situate this chunk within the overall document for the purposes of improving search retrieval of the chunk. Answer only with the succinct context and nothing else.`,
          },
        ],
      },
    ],
  }
}

/** A hash of everything but the model that decides what a context says. */
export function contextPromptHash(
  settings: Pick<ContextualizeSettings, 'effort' | 'maxTokens'>,
): string {
  return promptHash(JSON.stringify(contextRequest('', settings, '', '', true)))
}

/** What a manifest and a report's identity say wrote the contexts. */
export function contextIdentity(
  model: string,
  settings: Pick<ContextualizeSettings, 'effort' | 'maxTokens'>,
): string {
  return `${model}:${contextPromptHash(settings)}`
}

const needsContext = (chunk: ContextChunk, known: ReadonlyMap<string, StoredContext>): boolean =>
  known.get(chunk.id)?.textHash !== chunk.textHash

export interface ContextPlan {
  toGenerate: number
  documents: number
  tokens: { cacheWrite: number; cacheRead: number; uncached: number; output: number }
  inputUsd: number
  outputUsd: number
}

export interface PlanContextsOptions {
  model: string
  settings: ContextualizeSettings
  pricing: PricingSettings
  known: ReadonlyMap<string, StoredContext>
  /** Only these chunks, for a pilot. */
  only?: ReadonlySet<string> | undefined
}

/** A guess until a pilot replaces it: the write-up says usually 50 to 100 tokens. */
const OUTPUT_TOKENS_PER_CONTEXT = 100

function priceOf(model: string, pricing: PricingSettings) {
  const price = pricing.models[model]
  if (price === undefined) throw new Error(`settings hold no price for ${model}`)
  return {
    input: price.input,
    output: price.output ?? 0,
    cacheWrite: price.cacheWrite5m ?? price.input,
    cacheRead: price.cacheRead ?? price.input,
  }
}

function missingChunks(document: ContextDocument, options: PlanContextsOptions): ContextChunk[] {
  const { known, only } = options
  return document.chunks.filter(
    (chunk) => needsContext(chunk, known) && (only === undefined || only.has(chunk.id)),
  )
}

/** Which chunks need a call, and about what it costs at list prices. */
export function planContexts(
  documents: readonly ContextDocument[],
  options: PlanContextsOptions,
): ContextPlan {
  const { model, settings, pricing } = options
  const tokens = { cacheWrite: 0, cacheRead: 0, uncached: 0, output: 0 }
  let toGenerate = 0
  let touched = 0
  for (const document of documents) {
    const missing = missingChunks(document, options)
    if (missing.length === 0) continue
    touched++
    toGenerate += missing.length
    const size = estimateTokens(documentTextOf(document))
    if (missing.length > 1 && size >= settings.minCacheableTokens) {
      tokens.cacheWrite += size
      tokens.cacheRead += size * (missing.length - 1)
    } else {
      tokens.uncached += size * missing.length
    }
    for (const chunk of missing) {
      const request = contextRequest(model, settings, '', chunk.text, false)
      tokens.uncached += estimateTokens(JSON.stringify(request.messages))
      tokens.output += OUTPUT_TOKENS_PER_CONTEXT
    }
  }
  const price = priceOf(model, pricing)
  return {
    toGenerate,
    documents: touched,
    tokens,
    inputUsd:
      (tokens.uncached * price.input +
        tokens.cacheWrite * price.cacheWrite +
        tokens.cacheRead * price.cacheRead) /
      1_000_000,
    outputUsd: (tokens.output * price.output) / 1_000_000,
  }
}

/**
 * What the whole set would cost, from what a pilot measured: its input against its plan, since
 * Haiku's tokenizer counts more than the local estimate, and its output per context.
 */
export function forecastContexts(
  whole: ContextPlan,
  pilot: ContextPlan,
  used: Pick<ModelUsage, 'inputTokens' | 'outputTokens' | 'cacheWriteTokens' | 'cacheReadTokens'>,
  model: string,
  pricing: PricingSettings,
): { usd: number; outputTokensPerContext: number; inputAgainstPlan: number } {
  const price = priceOf(model, pricing)
  const inputUsd =
    (used.inputTokens * price.input +
      used.cacheWriteTokens * price.cacheWrite +
      used.cacheReadTokens * price.cacheRead) /
    1_000_000
  const inputAgainstPlan = pilot.inputUsd === 0 ? 1 : inputUsd / pilot.inputUsd
  const outputTokensPerContext = pilot.toGenerate === 0 ? 0 : used.outputTokens / pilot.toGenerate
  return {
    usd:
      whole.inputUsd * inputAgainstPlan +
      (whole.toGenerate * outputTokensPerContext * price.output) / 1_000_000,
    outputTokensPerContext,
    inputAgainstPlan,
  }
}

/** Chunks for a pilot: from documents with several, so that it shows prompt caching too. */
export function pilotChunks(
  documents: readonly ContextDocument[],
  known: ReadonlyMap<string, StoredContext>,
  count: number,
): Set<string> {
  const PER_DOCUMENT = 5
  const picked = new Set<string>()
  const sorted = [...documents].sort((a, b) => (a.path < b.path ? -1 : 1))
  for (const document of sorted) {
    const missing = document.chunks.filter((chunk) => needsContext(chunk, known))
    if (missing.length < 2) continue
    for (const chunk of missing.slice(0, PER_DOCUMENT)) {
      if (picked.size < count) picked.add(chunk.id)
    }
    if (picked.size === count) break
  }
  return picked
}

/** The run passed what settings allow for it, or a reply cannot be used. The message says which. */
export class ContextsStoppedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ContextsStoppedError'
  }
}

export interface GenerateContextsOptions extends PlanContextsOptions {
  client: AnswerClient
  meter: UsageMeter
  /** Called with each new context as soon as it exists, so that what was paid for is kept. */
  onContext: (context: StoredContext) => void
  onProgress?: ((done: number, total: number) => void) | undefined
}

function contextOf(message: Anthropic.Message, where: string): string {
  const text = message.content
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('')
    .trim()
  if (message.stop_reason !== 'end_turn') {
    throw new ContextsStoppedError(
      `the context of ${where} stopped with ${String(message.stop_reason)}, so it was not kept`,
    )
  }
  if (text === '') throw new ContextsStoppedError(`the context of ${where} is empty`)
  return text.replace(EM_DASH, '-')
}

/** Writes the contexts the plan says are missing, one document at a time. */
export async function generateContexts(
  documents: readonly ContextDocument[],
  options: GenerateContextsOptions,
): Promise<void> {
  const { client, model, settings, pricing, meter, onContext, onProgress } = options
  const total = planContexts(documents, options).toGenerate
  const spent = (): number => meter.estimateCost(pricing).byModel.get(model) ?? 0
  const overBudget = (): boolean => spent() >= settings.maxUsd
  let done = 0

  for (const document of documents) {
    const missing = missingChunks(document, options)
    if (missing.length === 0) continue
    const text = documentTextOf(document)
    const cache = missing.length > 1
    const generate = async (chunk: ContextChunk): Promise<void> => {
      const request = contextRequest(model, settings, text, chunk.text, cache)
      const message = await client.messages.stream(request).finalMessage()
      meter.recordMessage(model, message.usage)
      const where = `${chunk.id} in ${document.path}`
      onContext({
        chunkId: chunk.id,
        textHash: chunk.textHash,
        context: contextOf(message, where),
      })
      done++
      onProgress?.(done, total)
    }
    const [first, ...rest] = missing
    if (first !== undefined && !overBudget()) await generate(first)
    await forEachLimit(rest, settings.concurrency, generate, overBudget)
    if (overBudget() && done < total) {
      throw new ContextsStoppedError(
        `stopped at $${spent().toFixed(4)}, past the $${String(settings.maxUsd)} this run may spend, with ${String(done)} of ${String(total)} contexts written. They are kept, so a rerun pays only for the rest`,
      )
    }
  }
}
