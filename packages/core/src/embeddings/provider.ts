// The embedding provider interface. Ingest and retrieval depend only on this,
// so a local model can be added later next to Voyage (ADR-0004).
import { sha256Hex } from '@docs-rag-lab/source-kit'

export type InputType = 'document' | 'query'

export interface EmbedResult {
  /** One vector per input, in input order. */
  vectors: Float32Array[]
  /** Billed tokens, as the provider reports them. */
  tokens: number
}

export interface RateLimitProbe {
  /** Rate-limit headers from one request, lowercased names. Empty when the provider sends none. */
  headers: Record<string, string>
  tokens: number
}

export interface EmbeddingProvider {
  /** Identity of the vector space: provider, model and dimensions, for example voyage:voyage-4:1024. */
  readonly id: string
  /** The model name, used to look up its price. */
  readonly model: string
  readonly dimensions: number
  /** Per request: inputs, and estimated tokens. */
  readonly limits: { maxInputs: number; maxTokens: number }
  embed(texts: readonly string[], inputType: InputType): Promise<EmbedResult>
  /** Optional: one tiny request that reports the provider's rate-limit headers. */
  probeRateLimits?(): Promise<RateLimitProbe>
}

/** A failed provider request. `status` is undefined for network errors and timeouts. */
export class EmbeddingRequestError extends Error {
  readonly status: number | undefined
  readonly retryAfterMs: number | undefined

  constructor(
    message: string,
    options: { status?: number; retryAfterMs?: number; cause?: unknown },
  ) {
    super(message, { cause: options.cause })
    this.name = 'EmbeddingRequestError'
    this.status = options.status
    this.retryAfterMs = options.retryAfterMs
  }

  /** Rate limits, server errors and network failures are worth retrying. */
  get retryable(): boolean {
    return this.status === undefined || this.status === 429 || this.status >= 500
  }
}

/** The embedding cache key: sha256 of provider id (model and dimensions), input type and text. */
export function embeddingCacheKey(providerId: string, inputType: InputType, text: string): string {
  return sha256Hex(JSON.stringify([providerId, inputType, text]))
}
