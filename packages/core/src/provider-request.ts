// One request to a provider that bills tokens: a failure that says whether it is worth
// retrying, and the loop that waits for a slot, retries and settles the slot with what
// was billed. Embeddings and rerank share both.
import type { RateLimiter } from './embeddings/rate-limit.ts'

/** A failed provider request. `status` is undefined for network errors and timeouts. */
export class ProviderRequestError extends Error {
  readonly status: number | undefined
  readonly retryAfterMs: number | undefined

  constructor(
    message: string,
    options: { status?: number; retryAfterMs?: number; cause?: unknown },
  ) {
    super(message, { cause: options.cause })
    this.name = 'ProviderRequestError'
    this.status = options.status
    this.retryAfterMs = options.retryAfterMs
  }

  /** Rate limits, server errors and network failures are worth retrying. */
  get retryable(): boolean {
    return this.status === undefined || this.status === 429 || this.status >= 500
  }
}

export interface ProviderRequestOptions {
  limiter?: RateLimiter | undefined
  maxRetries?: number | undefined
  /**
   * For a caller whose answer to a rejection is to stop. A 429 can be a pacing collision, so it
   * gets one retry after a full idle window, and a 429 straight after that is final.
   */
  retryRateLimitOnce?: boolean | undefined
}

const DEFAULT_MAX_RETRIES = 6
const RATE_LIMITED_BACKOFF_MS = 60_000
const ERROR_BACKOFF_MS = 2_000
// A Retry-After beyond this is treated as this; the retry count bounds the rest.
const MAX_BACKOFF_MS = 5 * 60_000

/** Sends `request` when `estimate` tokens fit the limiter's window, and retries what is worth it. */
export async function requestWithRetries<T extends { tokens: number }>(
  estimate: number,
  request: () => Promise<T>,
  options: ProviderRequestOptions,
): Promise<T> {
  const { limiter } = options
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES
  // The last attempt got a 429, and nothing has been sent since, for a full window.
  let idledAfterRateLimit = false
  for (let attempt = 0; ; attempt++) {
    const slot = await limiter?.acquire(estimate)
    try {
      const result = await request()
      slot?.settle(result.tokens)
      return result
    } catch (error) {
      // The failed attempt still counts as a request, but carried no billed tokens.
      slot?.settle(0)
      if (!(error instanceof ProviderRequestError) || !error.retryable || attempt >= maxRetries) {
        throw error
      }
      const rateLimited = error.status === 429
      if (rateLimited && idledAfterRateLimit) throw error
      idledAfterRateLimit = rateLimited && options.retryRateLimitOnce === true
      const backoff = Math.min(
        MAX_BACKOFF_MS,
        error.retryAfterMs ??
          (rateLimited ? RATE_LIMITED_BACKOFF_MS : ERROR_BACKOFF_MS * 2 ** attempt),
      )
      // However short a Retry-After, a second 429 only says something after a full idle window.
      const wait = idledAfterRateLimit ? Math.max(RATE_LIMITED_BACKOFF_MS, backoff) : backoff
      if (limiter !== undefined) await limiter.wait(wait)
      else await new Promise((resolve) => setTimeout(resolve, wait))
    }
  }
}
