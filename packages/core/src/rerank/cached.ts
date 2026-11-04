// One rerank call through its cache (ADR-0014). The key is the whole call, since a score
// depends on the rest of its call: the provider and model, the query and the documents as
// sent. A 429 gets one retry after a full idle window, since it can be a pacing collision. A
// second one, or any other 4xx, is a rejection and stops the run: the ADR fixes what happens
// next, and what was cached so far stays.
import type { RerankCache } from '@docs-rag-lab/db'
import { sha256Hex } from '@docs-rag-lab/source-kit'

import type { RateLimiter } from '../embeddings/rate-limit.ts'
import { ProviderRequestError, requestWithRetries } from '../provider-request.ts'
import type { UsageMeter } from '../usage.ts'
import { estimateRerankTokens, type RerankProvider } from './provider.ts'

/** Voyage refused a rerank call for its limits or its size. The message says what happens next. */
export class RerankRejectedError extends Error {
  constructor(status: number, message: string, cause: unknown) {
    super(
      `Voyage rejected a rerank call (${String(status)}): ${message}. Stop here and tell the owner: ADR-0014 fixes a depth of 15 for both rows as the only fallback`,
      { cause },
    )
    this.name = 'RerankRejectedError'
  }
}

export interface RerankWithCacheOptions {
  provider: RerankProvider
  cache: RerankCache
  meter: UsageMeter
  limiter?: RateLimiter | undefined
  maxRetries?: number | undefined
}

export function rerankCacheKey(
  providerId: string,
  query: string,
  documents: readonly string[],
): string {
  return sha256Hex(JSON.stringify([providerId, query, documents]))
}

/** One score per document, in order, from the cache or from one call to the provider. */
export async function rerankWithCache(
  query: string,
  documents: readonly string[],
  options: RerankWithCacheOptions,
): Promise<{ scores: number[]; from: 'cache' | 'api' }> {
  const { provider, cache, meter, limiter, maxRetries } = options
  if (documents.length === 0) return { scores: [], from: 'cache' }

  const key = rerankCacheKey(provider.id, query, documents)
  const cached = cache.get(key)
  if (cached !== undefined) {
    if (cached.length !== documents.length) {
      throw new Error(
        `the rerank cache holds ${String(cached.length)} scores for a call of ${String(documents.length)} documents`,
      )
    }
    meter.recordRerankCacheHits(provider.model, 1)
    return { scores: cached, from: 'cache' }
  }

  try {
    const { scores, tokens } = await requestWithRetries(
      estimateRerankTokens(query, documents),
      () => provider.rerank(query, documents),
      { limiter, maxRetries, retryRateLimitOnce: true },
    )
    meter.recordRerank(provider.model, tokens)
    cache.put(key, provider.id, scores, tokens)
    return { scores, from: 'api' }
  } catch (error) {
    if (error instanceof ProviderRequestError && error.status !== undefined && error.status < 500) {
      throw new RerankRejectedError(error.status, error.message, error)
    }
    throw error
  }
}
