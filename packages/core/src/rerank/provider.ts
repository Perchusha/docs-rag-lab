// The rerank provider interface, and what a request weighs. Retrieval depends only
// on this, as it does with embeddings (ADR-0004).
import { estimateTokens } from '@docs-rag-lab/source-kit'

import type { RateLimitProbe } from '../embeddings/provider.ts'

export interface RerankResult {
  /** One score per document, in input order. Higher is more relevant. */
  scores: number[]
  /** Billed tokens, as the provider reports them. */
  tokens: number
}

export interface RerankProvider {
  /** Provider and model, for example voyage:rerank-3. */
  readonly id: string
  /** The model name, used to look up its price. */
  readonly model: string
  rerank(query: string, documents: readonly string[]): Promise<RerankResult>
  /** One tiny request that reports the provider's rate-limit headers. */
  probeRateLimits?(): Promise<RateLimitProbe>
}

/** Estimated tokens of one request: Voyage bills the query once per document, then the documents. */
export function estimateRerankTokens(query: string, documents: readonly string[]): number {
  const perDocument = estimateTokens(query)
  return documents.reduce((sum, text) => sum + perDocument + estimateTokens(text), 0)
}
