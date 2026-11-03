import { afterEach, describe, expect, it } from 'vitest'

import { EvalCache, openEvalCache } from './eval-cache.ts'

let cache: EvalCache | undefined

afterEach(() => {
  cache?.close()
  cache = undefined
})

function fresh(): EvalCache {
  cache = openEvalCache(':memory:')
  return cache
}

describe('EvalCache', () => {
  it('gives back what was stored, and nothing for an unknown key', () => {
    const store = fresh()
    store.put('k', 'answer', { value: { text: 'hi' }, inputTokens: 3, outputTokens: 4 })

    expect(store.get('k')).toEqual({ text: 'hi' })
    expect(store.has('k')).toBe(true)
    expect(store.get('other')).toBeUndefined()
    expect(store.has('other')).toBe(false)
  })

  it('keeps the first entry for a key, since that is what was paid for and judged', () => {
    const store = fresh()
    store.put('k', 'answer', { value: 'first', inputTokens: 1, outputTokens: 1 })
    store.put('k', 'answer', { value: 'second', inputTokens: 2, outputTokens: 2 })

    expect(store.get('k')).toBe('first')
  })

  it('averages the tokens of one kind only', () => {
    const store = fresh()
    store.put('a', 'answer', { value: 1, inputTokens: 100, outputTokens: 10 })
    store.put('b', 'answer', { value: 1, inputTokens: 300, outputTokens: 30 })
    store.put('c', 'judge', { value: 1, inputTokens: 999, outputTokens: 999 })

    expect(store.stats('answer')).toEqual({
      calls: 2,
      meanInputTokens: 200,
      meanOutputTokens: 20,
    })
  })

  it('says so when a kind has no calls yet', () => {
    expect(fresh().stats('judge')).toEqual({
      calls: 0,
      meanInputTokens: 0,
      meanOutputTokens: 0,
    })
  })
})
