import { describe, expect, it } from 'vitest'

import { fuseRrf } from './rrf.ts'

describe('fuseRrf', () => {
  it('scores each chunk as the sum of 1 / (k + rank) over its lists', () => {
    const fused = fuseRrf(
      [
        { name: 'vector', chunkIds: ['a', 'b', 'c'] },
        { name: 'keyword', chunkIds: ['c', 'a'] },
      ],
      60,
    )
    expect(fused.map((f) => f.chunkId)).toEqual(['a', 'c', 'b'])
    expect(fused[0]).toEqual({
      chunkId: 'a',
      rank: 1,
      score: 1 / 61 + 1 / 62,
      ranks: { vector: 1, keyword: 2 },
    })
    expect(fused[1]?.score).toBeCloseTo(1 / 63 + 1 / 61, 12)
    expect(fused[2]).toMatchObject({ rank: 3, score: 1 / 62, ranks: { vector: 2 } })
  })

  it('ranks a chunk found by two lists above one found by a single list at a similar rank', () => {
    const fused = fuseRrf(
      [
        { name: 'vector', chunkIds: ['x', 'both'] },
        { name: 'keyword', chunkIds: ['y', 'both'] },
      ],
      60,
    )
    expect(fused[0]?.chunkId).toBe('both')
  })

  it('breaks ties by the best single rank, then by chunk ID', () => {
    const fused = fuseRrf(
      [
        { name: 'vector', chunkIds: ['b', 'd'] },
        { name: 'keyword', chunkIds: ['a', 'c'] },
      ],
      60,
    )
    expect(fused.map((f) => f.chunkId)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('gives the same ranking with or without an empty list', () => {
    const lists = [
      { name: 'vector', chunkIds: ['a', 'b', 'c', 'd'] },
      { name: 'keyword', chunkIds: ['d', 'e', 'a'] },
    ] as const
    expect(fuseRrf([...lists, { name: 'exact', chunkIds: [] }], 60)).toEqual(fuseRrf(lists, 60))
  })

  it('counts a chunk once per list, at its best rank', () => {
    const fused = fuseRrf([{ name: 'keyword', chunkIds: ['a', 'b', 'a'] }], 60)
    expect(fused.find((f) => f.chunkId === 'a')).toMatchObject({
      score: 1 / 61,
      ranks: { keyword: 1 },
    })
  })

  it('returns nothing for no candidates', () => {
    expect(fuseRrf([], 60)).toEqual([])
  })
})
