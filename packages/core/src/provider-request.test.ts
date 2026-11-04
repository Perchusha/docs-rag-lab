import { describe, expect, it } from 'vitest'

import { RateLimiter, type Clock } from './embeddings/rate-limit.ts'
import { ProviderRequestError, requestWithRetries } from './provider-request.ts'

function fakeClock(): Clock {
  let now = 1_000_000
  return {
    now: () => now,
    sleep: (ms) => {
      now += ms
      return Promise.resolve()
    },
  }
}

function failingOnce(error: Error) {
  let calls = 0
  const request = () => {
    calls++
    return calls === 1 ? Promise.reject(error) : Promise.resolve({ tokens: 1 })
  }
  return { request, calls: () => calls }
}

describe('requestWithRetries', () => {
  const limiter = () => new RateLimiter({ rpm: 100, tpm: 1_000_000 }, fakeClock())

  it('retries a 429 by default, as a sync needs', async () => {
    const { request, calls } = failingOnce(new ProviderRequestError('busy', { status: 429 }))
    await expect(requestWithRetries(1, request, { limiter: limiter() })).resolves.toEqual({
      tokens: 1,
    })
    expect(calls()).toBe(2)
  })

  it('makes a 429 final when the caller stops on a rejection', async () => {
    const { request, calls } = failingOnce(new ProviderRequestError('busy', { status: 429 }))
    await expect(
      requestWithRetries(1, request, { limiter: limiter(), retryRateLimits: false }),
    ).rejects.toThrow('busy')
    expect(calls()).toBe(1)
  })

  it('still retries a server error when the caller stops on a rejection', async () => {
    const { request, calls } = failingOnce(
      new ProviderRequestError('unavailable', { status: 503, retryAfterMs: 1 }),
    )
    await requestWithRetries(1, request, { limiter: limiter(), retryRateLimits: false })
    expect(calls()).toBe(2)
  })
})
