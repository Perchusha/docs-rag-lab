import { describe, expect, it } from 'vitest'

import { RateLimiter, type Clock } from './embeddings/rate-limit.ts'
import { ProviderRequestError, requestWithRetries } from './provider-request.ts'

function fakeClock(): Clock & { slept: number[] } {
  let now = 1_000_000
  const slept: number[] = []
  return {
    slept,
    now: () => now,
    sleep: (ms) => {
      slept.push(ms)
      now += ms
      return Promise.resolve()
    },
  }
}

/** A request that fails with each of `errors` in turn and then succeeds, and when it was sent. */
function failing(clock: Clock, ...errors: Error[]) {
  const sentAt: number[] = []
  const request = () => {
    sentAt.push(clock.now())
    const error = errors[sentAt.length - 1]
    return error === undefined ? Promise.resolve({ tokens: 1 }) : Promise.reject(error)
  }
  return { request, sentAt }
}

const rateLimit = (retryAfterMs?: number): ProviderRequestError =>
  new ProviderRequestError('busy', {
    status: 429,
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  })

describe('requestWithRetries', () => {
  const setup = () => {
    const clock = fakeClock()
    return { clock, limiter: new RateLimiter({ rpm: 100, tpm: 1_000_000 }, clock) }
  }

  it('retries a 429 up to the limit by default, as a sync needs', async () => {
    const { clock, limiter } = setup()
    const { request, sentAt } = failing(clock, rateLimit(), rateLimit(), rateLimit())
    await expect(requestWithRetries(1, request, { limiter })).resolves.toEqual({ tokens: 1 })
    expect(sentAt).toHaveLength(4)
  })

  describe('with one retry of a 429', () => {
    const once = { retryRateLimitOnce: true }

    it('says when it waits out a 429, and not for a rejection or another failure', async () => {
      const { clock, limiter } = setup()
      let told = 0
      const onRateLimited = () => {
        told++
      }
      const survived = failing(clock, rateLimit())
      await requestWithRetries(1, survived.request, { limiter, ...once, onRateLimited })
      expect(told).toBe(1)

      const rejected = failing(clock, rateLimit(), rateLimit())
      await expect(
        requestWithRetries(1, rejected.request, { limiter, ...once, onRateLimited }),
      ).rejects.toThrow('busy')
      expect(told).toBe(2)

      const other = failing(
        clock,
        new ProviderRequestError('unavailable', { status: 503, retryAfterMs: 1 }),
      )
      await requestWithRetries(1, other.request, { limiter, ...once, onRateLimited })
      expect(told).toBe(2)
    })

    it('sends that same call again after a minute when there is no Retry-After', async () => {
      const { clock, limiter } = setup()
      const { request, sentAt } = failing(clock, rateLimit())
      await expect(requestWithRetries(1, request, { limiter, ...once })).resolves.toEqual({
        tokens: 1,
      })
      expect(sentAt).toHaveLength(2)
      expect(clock.slept).toEqual([60_000])
    })

    it('makes a second 429 final, as a rejection', async () => {
      const { clock, limiter } = setup()
      const { request, sentAt } = failing(clock, rateLimit(), rateLimit())
      await expect(requestWithRetries(1, request, { limiter, ...once })).rejects.toThrow('busy')
      expect(sentAt).toHaveLength(2)
      expect(clock.slept).toEqual([60_000])
    })

    it('waits as long as Retry-After says when that is over a minute', async () => {
      const { clock, limiter } = setup()
      const { request } = failing(clock, rateLimit(90_000))
      await requestWithRetries(1, request, { limiter, ...once })
      expect(clock.slept).toEqual([90_000])
    })

    it('waits the full minute when Retry-After says less, so a second 429 means something', async () => {
      const { clock, limiter } = setup()
      const { request } = failing(clock, rateLimit(5_000))
      await requestWithRetries(1, request, { limiter, ...once })
      expect(clock.slept).toEqual([60_000])
    })

    it('counts a Retry-After over five minutes as five', async () => {
      const { clock, limiter } = setup()
      const { request } = failing(clock, rateLimit(3_600_000))
      await requestWithRetries(1, request, { limiter, ...once })
      expect(clock.slept).toEqual([300_000])
    })

    it('leaves the window idle for that time, after a paced call too', async () => {
      const clock = fakeClock()
      const limiter = new RateLimiter({ rpm: 3, tpm: 10_000 }, clock)
      // 12K billed: the next call waits 72 seconds for the pacing.
      await requestWithRetries(14_000, () => Promise.resolve({ tokens: 12_000 }), { limiter })
      const { request, sentAt } = failing(clock, rateLimit())
      await requestWithRetries(14_000, request, { limiter, ...once })
      const [first, second] = sentAt
      expect((second ?? 0) - (first ?? 0)).toBeGreaterThanOrEqual(60_000)
      expect(clock.slept).toEqual([72_250, 60_000])
    })

    it('still retries a server error and a network failure as usual', async () => {
      const { clock, limiter } = setup()
      const { request, sentAt } = failing(
        clock,
        new ProviderRequestError('unavailable', { status: 503, retryAfterMs: 1 }),
        new ProviderRequestError('socket hang up', { retryAfterMs: 1 }),
      )
      await requestWithRetries(1, request, { limiter, ...once })
      expect(sentAt).toHaveLength(3)
      expect(clock.slept).toEqual([1, 1])
    })

    it('gives a 429 after a server error its own retry, since that came with no idle window', async () => {
      const { clock, limiter } = setup()
      const { request, sentAt } = failing(
        clock,
        rateLimit(),
        new ProviderRequestError('unavailable', { status: 503, retryAfterMs: 1 }),
        rateLimit(),
      )
      await requestWithRetries(1, request, { limiter, ...once })
      expect(sentAt).toHaveLength(4)
    })

    it('stops at once on any other 4xx', async () => {
      const { clock, limiter } = setup()
      const { request, sentAt } = failing(
        clock,
        new ProviderRequestError('too large', { status: 413 }),
      )
      await expect(requestWithRetries(1, request, { limiter, ...once })).rejects.toThrow(
        'too large',
      )
      expect(sentAt).toHaveLength(1)
      expect(clock.slept).toEqual([])
    })
  })
})
