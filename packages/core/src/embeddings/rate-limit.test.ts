import { describe, expect, it } from 'vitest'

import { RateLimiter, type Clock } from './rate-limit.ts'

/** A clock whose sleep advances time instantly. */
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

describe('RateLimiter', () => {
  it('lets requests through until the RPM limit, then waits for the window', async () => {
    const clock = fakeClock()
    const limiter = new RateLimiter({ rpm: 3, tpm: 1_000_000 }, clock)

    await limiter.acquire(10)
    await limiter.acquire(10)
    await limiter.acquire(10)
    expect(clock.slept).toEqual([])

    await limiter.acquire(10)
    expect(clock.slept).toEqual([60_250])
    expect(limiter.waitedMs).toBe(60_250)
  })

  it('waits when billed tokens would exceed the TPM limit', async () => {
    const clock = fakeClock()
    const limiter = new RateLimiter({ rpm: 100, tpm: 10_000 }, clock)

    const slot = await limiter.acquire(4_000)
    slot.settle(7_000) // billed more than estimated
    await limiter.acquire(2_000)
    expect(clock.slept).toEqual([])

    await limiter.acquire(2_000) // 7,000 + 2,000 + 2,000 > 10,000
    expect(clock.slept).toEqual([60_250])
  })

  it('lets a request larger than the whole budget through once the window is empty', async () => {
    const clock = fakeClock()
    const limiter = new RateLimiter({ rpm: 3, tpm: 10_000 }, clock)

    await limiter.acquire(25_000)
    expect(clock.slept).toEqual([])
    await limiter.acquire(1)
    expect(clock.slept).toEqual([60_250])
  })

  it('counts retry backoff as waiting', async () => {
    const clock = fakeClock()
    const limiter = new RateLimiter({ rpm: 3, tpm: 10_000 }, clock)
    await limiter.wait(5_000)
    expect(limiter.waitedMs).toBe(5_000)
    expect(clock.slept).toEqual([5_000])
  })

  it('rejects non-positive limits', () => {
    expect(() => new RateLimiter({ rpm: 0, tpm: 1 })).toThrow('rate limits must be positive')
  })
})
