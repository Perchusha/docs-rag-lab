import { describe, expect, it } from 'vitest'

import { checkContextualIndex } from './check.ts'

interface Row {
  id: string
  textHash: string
  context: string | null
}

const indexOf = (rows: Row[], commitSha = 'c1') => ({
  chunkFingerprints: () => rows,
  getManifest: () => ({ commitSha }) as never,
})

const plain = (id: string, textHash = `hash ${id}`): Row => ({ id, textHash, context: null })
const contextual = (id: string, textHash = `hash ${id}`): Row => ({
  id,
  textHash,
  context: `Context of ${id}.`,
})

describe('checkContextualIndex', () => {
  it('finds nothing wrong with the same chunks at the same commit, each with a context', () => {
    expect(
      checkContextualIndex(
        indexOf([plain('a'), plain('b')]),
        indexOf([contextual('a'), contextual('b')]),
      ),
    ).toEqual({ chunks: 2, contexts: 2, problems: [] })
  })

  it('says when the two are at different commits', () => {
    const { problems } = checkContextualIndex(indexOf([], 'c1'), indexOf([], 'c2'))
    expect(problems).toEqual(['the plain index is at c1, and the contextual one at c2'])
  })

  it('says which chunks only one of them has', () => {
    const { problems } = checkContextualIndex(
      indexOf([plain('a'), plain('gone')]),
      indexOf([contextual('a'), contextual('new')]),
    )
    expect(problems).toEqual([
      '1 chunks are only in the plain index: gone',
      '1 chunks are only in the contextual index: new',
    ])
  })

  it('says which chunks have another text', () => {
    const { problems } = checkContextualIndex(
      indexOf([plain('a', 'one')]),
      indexOf([contextual('a', 'two')]),
    )
    expect(problems).toEqual(['1 chunks have another text: a'])
  })

  it.each([
    ['no context', null],
    ['an empty one', '  '],
  ])('counts a chunk with %s as having none', (_, context) => {
    const { contexts, problems } = checkContextualIndex(
      indexOf([plain('a')]),
      indexOf([{ id: 'a', textHash: 'hash a', context }]),
    )
    expect(contexts).toBe(0)
    expect(problems).toEqual(['1 chunks have no context: a'])
  })

  it('names a few examples and how many more', () => {
    const rows = ['a', 'b', 'c', 'd', 'e'].map((id) => contextual(id))
    const { problems } = checkContextualIndex(indexOf([]), indexOf(rows))
    expect(problems).toEqual(['5 chunks are only in the contextual index: a, b, c, and 2 more'])
  })
})
