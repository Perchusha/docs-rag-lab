// Embeds texts through the shared cache (ADR-0003): cached vectors are reused,
// misses are batched, rate limited and retried, and every batch is written to
// the cache as soon as it returns, so an interrupted sync resumes for free.
import type { EmbeddingCache } from '@docs-rag-lab/db'
import { estimateTokens } from '@docs-rag-lab/source-kit'

import type { UsageMeter } from '../usage.ts'
import {
  embeddingCacheKey,
  EmbeddingRequestError,
  type EmbeddingProvider,
  type InputType,
} from './provider.ts'
import type { RateLimiter } from './rate-limit.ts'

export interface EmbedProgress {
  /** Inputs embedded through the API so far, and how many need it in total. */
  embedded: number
  toEmbed: number
  /** Inputs that came from the cache. */
  cached: number
  /** Estimated tokens of the inputs embedded so far, to compare with billed tokens. */
  estimatedTokens: number
  waitedMs: number
}

export interface EmbedWithCacheOptions {
  provider: EmbeddingProvider
  cache: EmbeddingCache
  inputType: InputType
  meter: UsageMeter
  limiter?: RateLimiter | undefined
  maxRetries?: number
  onProgress?: ((progress: EmbedProgress) => void) | undefined
}

const DEFAULT_MAX_RETRIES = 6
const RATE_LIMITED_BACKOFF_MS = 60_000
const ERROR_BACKOFF_MS = 2_000
// A Retry-After beyond this is treated as this; the retry count bounds the rest.
const MAX_BACKOFF_MS = 5 * 60_000

/** Groups texts into requests within the provider's input and estimated-token limits. */
export function batchForProvider(
  texts: readonly string[],
  limits: { maxInputs: number; maxTokens: number },
): string[][] {
  const batches: string[][] = []
  let current: string[] = []
  let tokens = 0
  for (const text of texts) {
    const size = estimateTokens(text)
    if (
      current.length > 0 &&
      (current.length >= limits.maxInputs || tokens + size > limits.maxTokens)
    ) {
      batches.push(current)
      current = []
      tokens = 0
    }
    current.push(text)
    tokens += size
  }
  if (current.length > 0) batches.push(current)
  return batches
}

async function embedBatch(
  batch: readonly string[],
  options: EmbedWithCacheOptions,
): Promise<Float32Array[]> {
  const { provider, inputType, limiter, meter } = options
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES
  const estimate = batch.reduce((sum, text) => sum + estimateTokens(text), 0)
  for (let attempt = 0; ; attempt++) {
    const slot = await limiter?.acquire(estimate)
    try {
      const result = await provider.embed(batch, inputType)
      slot?.settle(result.tokens)
      meter.recordEmbedding(provider.model, result.tokens)
      return result.vectors
    } catch (error) {
      // The failed attempt still counts as a request, but carried no billed tokens.
      slot?.settle(0)
      if (!(error instanceof EmbeddingRequestError) || !error.retryable || attempt >= maxRetries) {
        throw error
      }
      const backoff = Math.min(
        MAX_BACKOFF_MS,
        error.retryAfterMs ??
          (error.status === 429 ? RATE_LIMITED_BACKOFF_MS : ERROR_BACKOFF_MS * 2 ** attempt),
      )
      if (limiter !== undefined) await limiter.wait(backoff)
      else await new Promise((resolve) => setTimeout(resolve, backoff))
    }
  }
}

/** One vector per text, in order, from the cache or the provider. */
export async function embedWithCache(
  texts: readonly string[],
  options: EmbedWithCacheOptions,
): Promise<Float32Array[]> {
  const { provider, cache, inputType, meter } = options
  const keyOf = (text: string): string => embeddingCacheKey(provider.id, inputType, text)

  const unique = [...new Set(texts)]
  const vectors = cache.getMany(unique.map(keyOf))
  const misses = unique.filter((text) => !vectors.has(keyOf(text)))
  const cached = unique.length - misses.length
  meter.recordEmbeddingCacheHits(provider.model, cached)

  let embedded = 0
  let estimatedTokens = 0
  const report = (): void => {
    options.onProgress?.({
      embedded,
      toEmbed: misses.length,
      cached,
      estimatedTokens,
      waitedMs: options.limiter?.waitedMs ?? 0,
    })
  }
  for (const batch of batchForProvider(misses, provider.limits)) {
    const batchVectors = await embedBatch(batch, options)
    if (batchVectors.length !== batch.length) {
      throw new Error(
        `provider returned ${String(batchVectors.length)} vectors for ${String(batch.length)} inputs`,
      )
    }
    const entries = batch.map((text, i) => {
      const vector = batchVectors[i]
      if (vector?.length !== provider.dimensions) {
        throw new Error(
          `provider returned a vector with ${String(vector?.length)} dimensions, expected ${String(provider.dimensions)}`,
        )
      }
      return { key: keyOf(text), provider: provider.id, inputType, vector }
    })
    cache.putMany(entries)
    for (const entry of entries) vectors.set(entry.key, entry.vector)
    embedded += batch.length
    estimatedTokens += batch.reduce((sum, text) => sum + estimateTokens(text), 0)
    report()
  }

  return texts.map((text) => {
    const vector = vectors.get(keyOf(text))
    if (vector === undefined) throw new Error('missing vector after embedding')
    return vector
  })
}
