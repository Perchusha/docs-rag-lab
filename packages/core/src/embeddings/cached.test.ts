import { openEmbeddingCache, type EmbeddingCache } from '@docs-rag-lab/db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { RecordingProvider } from '../test-helpers.ts'
import { UsageMeter } from '../usage.ts'
import { batchForProvider, embedWithCache } from './cached.ts'
import {
  EmbeddingRequestError,
  type EmbeddingProvider,
  type EmbedResult,
  type InputType,
} from './provider.ts'
import { RateLimiter, type Clock } from './rate-limit.ts'

let cache: EmbeddingCache

beforeEach(() => {
  cache = openEmbeddingCache(':memory:')
})

afterEach(() => {
  cache.close()
})

const instantClock = (): Clock => {
  let now = 0
  return {
    now: () => now,
    sleep: (ms) => {
      now += ms
      return Promise.resolve()
    },
  }
}

/** Fails the first `failures` calls with the given error, then embeds. */
class FlakyProvider extends RecordingProvider {
  #failures: number
  readonly #error: () => Error

  constructor(failures: number, error: () => Error) {
    super()
    this.#failures = failures
    this.#error = error
  }

  override embed(texts: readonly string[], inputType: InputType): Promise<EmbedResult> {
    if (this.#failures > 0) {
      this.#failures--
      return Promise.reject(this.#error())
    }
    return super.embed(texts, inputType)
  }
}

describe('embedWithCache', () => {
  it('embeds misses once, serves repeats from the cache and records usage', async () => {
    const provider = new RecordingProvider()
    const meter = new UsageMeter()

    const first = await embedWithCache(['a b', 'c', 'a b'], {
      provider,
      cache,
      inputType: 'document',
      meter,
    })
    const second = await embedWithCache(['c', 'd'], {
      provider,
      cache,
      inputType: 'document',
      meter,
    })

    expect(provider.embedded).toEqual(['a b', 'c', 'd'])
    expect(first[0]).toEqual(first[2])
    expect(second[0]).toEqual(first[1])
    expect(meter.entries()).toEqual([
      [
        'fake-embed',
        expect.objectContaining({ kind: 'embedding', requests: 2, inputTokens: 4, cacheHits: 1 }),
      ],
    ])
  })

  it('keys the cache by input type', async () => {
    const provider = new RecordingProvider()
    const meter = new UsageMeter()
    await embedWithCache(['q'], { provider, cache, inputType: 'document', meter })
    await embedWithCache(['q'], { provider, cache, inputType: 'query', meter })
    expect(provider.calls.map((call) => call.inputType)).toEqual(['document', 'query'])
  })

  it('reports progress per batch', async () => {
    const provider = new RecordingProvider({ maxInputs: 2 })
    const progress: number[] = []
    await embedWithCache(['a', 'b', 'c'], {
      provider,
      cache,
      inputType: 'document',
      meter: new UsageMeter(),
      onProgress: (p) => progress.push(p.embedded),
    })
    expect(progress).toEqual([2, 3])
  })

  it('retries rate limits and server errors with backoff counted as waiting', async () => {
    const provider = new FlakyProvider(
      2,
      () => new EmbeddingRequestError('busy', { status: 429, retryAfterMs: 1_500 }),
    )
    const limiter = new RateLimiter({ rpm: 100, tpm: 1_000_000 }, instantClock())

    const vectors = await embedWithCache(['x'], {
      provider,
      cache,
      inputType: 'document',
      meter: new UsageMeter(),
      limiter,
    })

    expect(vectors).toHaveLength(1)
    expect(limiter.waitedMs).toBe(3_000)
  })

  it('does not retry a client error', async () => {
    const provider = new FlakyProvider(
      1,
      () => new EmbeddingRequestError('bad key', { status: 401 }),
    )
    await expect(
      embedWithCache(['x'], { provider, cache, inputType: 'document', meter: new UsageMeter() }),
    ).rejects.toThrow('bad key')
  })

  it('retries server and network errors with exponential backoff, then gives up', async () => {
    const provider = new FlakyProvider(
      Number.POSITIVE_INFINITY,
      () => new EmbeddingRequestError('unavailable', { status: 503 }),
    )
    const limiter = new RateLimiter({ rpm: 100, tpm: 1_000_000 }, instantClock())
    let attempts = 0
    const counting: EmbeddingProvider = {
      id: provider.id,
      model: provider.model,
      dimensions: provider.dimensions,
      limits: provider.limits,
      embed: (texts, inputType) => {
        attempts++
        return provider.embed(texts, inputType)
      },
    }

    await expect(
      embedWithCache(['x'], {
        provider: counting,
        cache,
        inputType: 'document',
        meter: new UsageMeter(),
        limiter,
      }),
    ).rejects.toThrow('unavailable')

    // 1 attempt + 6 retries; backoff 2s, 4s, ..., 64s between them.
    expect(attempts).toBe(7)
    expect(limiter.waitedMs).toBe(2_000 + 4_000 + 8_000 + 16_000 + 32_000 + 64_000)
  })

  it('retries a network error, which has no status', async () => {
    const provider = new FlakyProvider(1, () => new EmbeddingRequestError('socket hang up', {}))
    const limiter = new RateLimiter({ rpm: 100, tpm: 1_000_000 }, instantClock())
    const vectors = await embedWithCache(['x'], {
      provider,
      cache,
      inputType: 'document',
      meter: new UsageMeter(),
      limiter,
    })
    expect(vectors).toHaveLength(1)
    expect(limiter.waitedMs).toBe(2_000)
  })

  it('caps a long Retry-After at 5 minutes', async () => {
    const provider = new FlakyProvider(
      1,
      () => new EmbeddingRequestError('busy', { status: 429, retryAfterMs: 3_600_000 }),
    )
    const limiter = new RateLimiter({ rpm: 100, tpm: 1_000_000 }, instantClock())
    await embedWithCache(['x'], {
      provider,
      cache,
      inputType: 'document',
      meter: new UsageMeter(),
      limiter,
    })
    expect(limiter.waitedMs).toBe(300_000)
  })

  it('writes each batch to the cache as soon as it returns, before a later batch fails', async () => {
    const inner = new RecordingProvider({ maxInputs: 1 })
    let calls = 0
    const secondFails: EmbeddingProvider = {
      id: inner.id,
      model: inner.model,
      dimensions: inner.dimensions,
      limits: inner.limits,
      embed: (texts, inputType) => {
        calls++
        if (calls === 2) return Promise.reject(new EmbeddingRequestError('denied', { status: 403 }))
        return inner.embed(texts, inputType)
      },
    }

    await expect(
      embedWithCache(['a', 'b'], {
        provider: secondFails,
        cache,
        inputType: 'document',
        meter: new UsageMeter(),
      }),
    ).rejects.toThrow('denied')

    expect(cache.count()).toBe(1)
    const again = await embedWithCache(['a', 'b'], {
      provider: inner,
      cache,
      inputType: 'document',
      meter: new UsageMeter(),
    })
    expect(again).toHaveLength(2)
    expect(inner.embedded).toEqual(['a', 'b'])
  })

  it('rejects vectors with the wrong dimensions', async () => {
    // Claims 8 dimensions but returns 4-dimensional vectors.
    const inner = new RecordingProvider({ dimensions: 4 })
    const wrong: EmbeddingProvider = {
      id: 'fake:wrong:8',
      model: inner.model,
      dimensions: 8,
      limits: inner.limits,
      embed: (texts, inputType) => inner.embed(texts, inputType),
    }
    await expect(
      embedWithCache(['x'], {
        provider: wrong,
        cache,
        inputType: 'document',
        meter: new UsageMeter(),
      }),
    ).rejects.toThrow('expected 8')
  })
})

describe('batchForProvider', () => {
  it('splits by input count and estimated tokens', () => {
    const long = 'x'.repeat(35) // 10 estimated tokens
    expect(batchForProvider(['a', 'b', 'c'], { maxInputs: 2, maxTokens: 1000 })).toEqual([
      ['a', 'b'],
      ['c'],
    ])
    expect(batchForProvider([long, long, long], { maxInputs: 100, maxTokens: 25 })).toEqual([
      [long, long],
      [long],
    ])
  })
})
