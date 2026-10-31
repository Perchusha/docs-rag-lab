import { afterEach, describe, expect, it } from 'vitest'

import { openEmbeddingCache, type EmbeddingCache } from './embedding-cache.ts'

let cache: EmbeddingCache | undefined

afterEach(() => {
  cache?.close()
  cache = undefined
})

describe('EmbeddingCache', () => {
  it('round-trips vectors exactly and reports misses as absent', () => {
    cache = openEmbeddingCache(':memory:')
    const vector = new Float32Array([0.1, -0.2, 0.3, 1e-7])
    cache.putMany([{ key: 'k1', provider: 'fake:model:4', inputType: 'document', vector }])

    const found = cache.getMany(['k1', 'k2'])
    expect([...found.keys()]).toEqual(['k1'])
    expect(found.get('k1')).toEqual(vector)
  })

  it('keeps the first vector stored under a key', () => {
    cache = openEmbeddingCache(':memory:')
    cache.putMany([
      { key: 'k', provider: 'p', inputType: 'query', vector: new Float32Array([1, 2]) },
    ])
    cache.putMany([
      { key: 'k', provider: 'p', inputType: 'query', vector: new Float32Array([3, 4]) },
    ])

    expect(cache.getMany(['k']).get('k')).toEqual(new Float32Array([1, 2]))
    expect(cache.count()).toBe(1)
  })

  it('looks up more keys than fit in one query', () => {
    cache = openEmbeddingCache(':memory:')
    const keys = Array.from({ length: 1234 }, (_, i) => `key-${String(i)}`)
    cache.putMany(
      keys.map((key, i) => ({
        key,
        provider: 'p',
        inputType: 'document',
        vector: new Float32Array([i]),
      })),
    )

    const found = cache.getMany(keys)
    expect(found.size).toBe(1234)
    expect(found.get('key-1233')).toEqual(new Float32Array([1233]))
  })
})
