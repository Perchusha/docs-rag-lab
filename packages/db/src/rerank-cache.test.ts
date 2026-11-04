import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { openRerankCache } from './rerank-cache.ts'

describe('RerankCache', () => {
  it('returns nothing for a call it has not seen', () => {
    const cache = openRerankCache(':memory:')
    expect(cache.get('nope')).toBeUndefined()
    expect(cache.count()).toBe(0)
    cache.close()
  })

  it('replays scores exactly, since reports compare them byte for byte', () => {
    const cache = openRerankCache(':memory:')
    const scores = [0.903148353099823, 0.3414119482040405, 5.960464477539063e-8, 1, 0]
    cache.put('k', 'voyage:rerank-test', scores, 60)
    expect(cache.get('k')).toEqual(scores)
    cache.close()
  })

  it('keeps the first entry for a key, since that is what the reports measured', () => {
    const cache = openRerankCache(':memory:')
    cache.put('k', 'voyage:rerank-test', [0.5], 10)
    cache.put('k', 'voyage:rerank-test', [0.6], 10)
    expect(cache.get('k')).toEqual([0.5])
    expect(cache.count()).toBe(1)
    cache.close()
  })

  it('keeps calls across a reopen, so a stopped run resumes for free', () => {
    const dir = mkdtempSync(join(tmpdir(), 'drl-rerank-cache-'))
    try {
      const path = join(dir, 'rerank-cache.sqlite')
      const first = openRerankCache(path)
      first.put('k', 'voyage:rerank-test', [0.25], 10)
      first.close()
      const second = openRerankCache(path)
      expect(second.get('k')).toEqual([0.25])
      second.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
