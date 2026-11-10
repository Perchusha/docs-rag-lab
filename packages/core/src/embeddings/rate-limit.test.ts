import { describe, expect, it, vi } from 'vitest'

import { RateLimiter, systemClock, type Clock } from './rate-limit.ts'

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
    expect(clock.slept).toEqual([150_250]) // 2.5 minutes of budget
  })

  it('holds the window longer after a request over the budget, so the average stays under it', async () => {
    const clock = fakeClock()
    const limiter = new RateLimiter({ rpm: 3, tpm: 10_000 }, clock)

    const slot = await limiter.acquire(14_000)
    slot.settle(12_000) // billed less than estimated: the billed count sets the hold
    await limiter.acquire(14_000)
    expect(clock.slept).toEqual([72_250])
  })

  it('holds a request at the budget or under it for the usual minute', async () => {
    const clock = fakeClock()
    const limiter = new RateLimiter({ rpm: 3, tpm: 10_000 }, clock)

    const slot = await limiter.acquire(10_000)
    slot.settle(10_000)
    await limiter.acquire(10_000)
    expect(clock.slept).toEqual([60_250])
  })

  it('counts retry backoff as waiting', async () => {
    const clock = fakeClock()
    const limiter = new RateLimiter({ rpm: 3, tpm: 10_000 }, clock)
    await limiter.wait(5_000)
    expect(limiter.waitedMs).toBe(5_000)
    expect(clock.slept).toEqual([5_000])
  })

  it('says how long it is about to wait, before it waits', async () => {
    const clock = fakeClock()
    const limiter = new RateLimiter({ rpm: 1, tpm: 1_000_000 }, clock)
    const told: number[] = []
    await limiter.acquire(10)

    await limiter.acquire(10, { onWait: (ms) => told.push(ms) })

    expect(told).toEqual([60_250])
    expect(clock.slept).toEqual([60_250])
  })

  it('gives up a wait when its signal aborts, and waits for nothing after an abort', async () => {
    // A clock that never wakes, as a long wait looks to a person who stops it.
    const clock: Clock = { now: () => 1_000_000, sleep: () => new Promise(() => undefined) }
    const limiter = new RateLimiter({ rpm: 1, tpm: 1_000_000 }, clock)
    await limiter.acquire(10)
    const controller = new AbortController()

    const waiting = limiter.acquire(10, { signal: controller.signal })
    controller.abort(new Error('stopped'))

    await expect(waiting).rejects.toThrow('stopped')
    await expect(limiter.acquire(10, { signal: controller.signal })).rejects.toThrow('stopped')
  })

  it("ends the system clock's timer when the signal aborts, so none outlives a Stop", async () => {
    vi.useFakeTimers()
    try {
      const controller = new AbortController()
      const sleeping = systemClock.sleep(60_000, controller.signal)
      expect(vi.getTimerCount()).toBe(1)
      controller.abort()
      await sleeping
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects non-positive limits', () => {
    expect(() => new RateLimiter({ rpm: 0, tpm: 1 })).toThrow('rate limits must be positive')
  })
})
