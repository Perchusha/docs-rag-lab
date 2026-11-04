import { openRerankCache, type RerankCache } from '@docs-rag-lab/db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { RateLimiter, type Clock } from '../embeddings/rate-limit.ts'
import { ProviderRequestError } from '../provider-request.ts'
import { UsageMeter } from '../usage.ts'
import { rerankCacheKey, RerankRejectedError, rerankWithCache } from './cached.ts'
import type { RerankProvider, RerankResult } from './provider.ts'

let cache: RerankCache

beforeEach(() => {
  cache = openRerankCache(':memory:')
})

afterEach(() => {
  cache.close()
})

function fakeProvider(respond?: (call: number) => RerankResult | Error) {
  const calls: { query: string; documents: string[] }[] = []
  const provider: RerankProvider = {
    id: 'fake:rerank',
    model: 'fake-rerank',
    rerank: (query, documents) => {
      calls.push({ query, documents: [...documents] })
      const result = respond?.(calls.length) ?? {
        scores: documents.map((_, i) => 1 / (i + 1)),
        tokens: 40,
      }
      return result instanceof Error ? Promise.reject(result) : Promise.resolve(result)
    },
  }
  return { provider, calls }
}

/** A clock whose sleep advances time instantly, and the waits it was asked for. */
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

describe('rerankWithCache', () => {
  it('makes one call for all documents, in order, and records what it billed', async () => {
    const { provider, calls } = fakeProvider()
    const meter = new UsageMeter()
    const result = await rerankWithCache('q', ['a', 'b'], { provider, cache, meter })
    expect(calls).toEqual([{ query: 'q', documents: ['a', 'b'] }])
    expect(result).toEqual({ scores: [1, 0.5], from: 'api' })
    expect(meter.entries()).toEqual([
      ['fake-rerank', expect.objectContaining({ kind: 'rerank', requests: 1, inputTokens: 40 })],
    ])
  })

  it('replays the same call from the cache, with no request', async () => {
    const { provider, calls } = fakeProvider()
    await rerankWithCache('q', ['a', 'b'], { provider, cache, meter: new UsageMeter() })
    const meter = new UsageMeter()
    const again = await rerankWithCache('q', ['a', 'b'], { provider, cache, meter })
    expect(calls).toHaveLength(1)
    expect(again).toEqual({ scores: [1, 0.5], from: 'cache' })
    expect(meter.entries()).toEqual([
      ['fake-rerank', expect.objectContaining({ kind: 'rerank', requests: 0, cacheHits: 1 })],
    ])
  })

  it.each<[string, string, string[]]>([
    ['another query', 'other', ['a', 'b']],
    ['another document', 'q', ['a', 'c']],
    ['fewer documents, since a pair scores differently in another set', 'q', ['a']],
    ['another order', 'q', ['b', 'a']],
  ])('calls again for %s', async (_, query, documents) => {
    const { provider, calls } = fakeProvider()
    const meter = new UsageMeter()
    await rerankWithCache('q', ['a', 'b'], { provider, cache, meter })
    await rerankWithCache(query, documents, { provider, cache, meter })
    expect(calls).toHaveLength(2)
  })

  it('keys a call by its provider and model too, and cannot run two documents together', () => {
    const key = rerankCacheKey('p', 'q', ['a', 'b'])
    expect(rerankCacheKey('other', 'q', ['a', 'b'])).not.toBe(key)
    expect(rerankCacheKey('p', 'q', ['a b'])).not.toBe(key)
    expect(rerankCacheKey('p', 'q', ['ab', ''])).not.toBe(rerankCacheKey('p', 'q', ['a', 'b']))
  })

  it('makes no call for no documents', async () => {
    const { provider, calls } = fakeProvider()
    expect(await rerankWithCache('q', [], { provider, cache, meter: new UsageMeter() })).toEqual({
      scores: [],
      from: 'cache',
    })
    expect(calls).toEqual([])
    expect(cache.count()).toBe(0)
  })

  it('refuses a cached call whose scores do not fit its documents', async () => {
    const { provider } = fakeProvider()
    cache.put(rerankCacheKey(provider.id, 'q', ['a', 'b']), provider.id, [1], 1)
    await expect(
      rerankWithCache('q', ['a', 'b'], { provider, cache, meter: new UsageMeter() }),
    ).rejects.toThrow(/holds 1 scores for a call of 2/)
  })

  it('gives a 429 one retry after a full idle window, since it can be a pacing collision', async () => {
    const { provider, calls } = fakeProvider((call) =>
      call === 1 ? new ProviderRequestError('busy', { status: 429 }) : { scores: [0.5], tokens: 5 },
    )
    const clock = fakeClock()
    const result = await rerankWithCache('q', ['a'], {
      provider,
      cache,
      meter: new UsageMeter(),
      limiter: new RateLimiter({ rpm: 100, tpm: 1_000_000 }, clock),
    })
    expect(result).toEqual({ scores: [0.5], from: 'api' })
    expect(calls).toEqual([
      { query: 'q', documents: ['a'] },
      { query: 'q', documents: ['a'] },
    ])
    expect(clock.slept).toEqual([60_000])
    expect(cache.count()).toBe(1)
  })

  it('takes a second 429 as a rejection, keeps nothing and tells what happens next', async () => {
    const { provider, calls } = fakeProvider(
      () => new ProviderRequestError('busy', { status: 429 }),
    )
    const clock = fakeClock()
    const error: unknown = await rerankWithCache('q', ['a'], {
      provider,
      cache,
      meter: new UsageMeter(),
      limiter: new RateLimiter({ rpm: 100, tpm: 1_000_000 }, clock),
    }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(RerankRejectedError)
    expect((error as Error).message).toContain('(429)')
    expect((error as Error).message).toContain('depth of 15 for both rows')
    expect(calls).toHaveLength(2)
    expect(clock.slept).toEqual([60_000])
    expect(cache.count()).toBe(0)
  })

  it.each([
    ['a request too large', 413],
    ['a bad request', 400],
  ])('stops at once on %s, keeps nothing and tells what happens next', async (_, status) => {
    const { provider, calls } = fakeProvider(
      () => new ProviderRequestError('refused', { status, retryAfterMs: 1 }),
    )
    const clock = fakeClock()
    const error: unknown = await rerankWithCache('q', ['a'], {
      provider,
      cache,
      meter: new UsageMeter(),
      limiter: new RateLimiter({ rpm: 100, tpm: 1_000_000 }, clock),
    }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(RerankRejectedError)
    expect((error as Error).message).toContain(`(${String(status)})`)
    expect((error as Error).message).toContain('depth of 15 for both rows')
    expect(calls).toHaveLength(1)
    expect(clock.slept).toEqual([])
    expect(cache.count()).toBe(0)
  })

  it('retries a server error and a network failure, which are no rejection', async () => {
    const failures = [
      new ProviderRequestError('unavailable', { status: 503, retryAfterMs: 1 }),
      new ProviderRequestError('socket hang up', { retryAfterMs: 1 }),
    ]
    const { provider, calls } = fakeProvider((call) => {
      return failures[call - 1] ?? { scores: [0.5], tokens: 5 }
    })
    const clock = fakeClock()
    const result = await rerankWithCache('q', ['a'], {
      provider,
      cache,
      meter: new UsageMeter(),
      limiter: new RateLimiter({ rpm: 100, tpm: 1_000_000 }, clock),
    })
    expect(calls).toHaveLength(3)
    expect(result).toEqual({ scores: [0.5], from: 'api' })
  })

  it('passes a failure that is not a provider request as it is', async () => {
    const { provider } = fakeProvider(() => new Error('a bug'))
    await expect(
      rerankWithCache('q', ['a'], { provider, cache, meter: new UsageMeter() }),
    ).rejects.toThrow('a bug')
  })

  it('reports a server error that outlasts the retries as what it is, no rejection', async () => {
    const { provider } = fakeProvider(
      () => new ProviderRequestError('unavailable', { status: 503, retryAfterMs: 1 }),
    )
    const error: unknown = await rerankWithCache('q', ['a'], {
      provider,
      cache,
      meter: new UsageMeter(),
      limiter: new RateLimiter({ rpm: 100, tpm: 1_000_000 }, fakeClock()),
      maxRetries: 1,
    }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ProviderRequestError)
  })
})
