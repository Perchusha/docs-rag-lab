import { describe, expect, it } from 'vitest'

import { checkVariantIndex } from './check.ts'

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

describe('checkVariantIndex', () => {
  it('finds nothing wrong with the same chunks at the same commit, each with a context', () => {
    expect(
      checkVariantIndex(
        indexOf([plain('a'), plain('b')]),
        indexOf([contextual('a'), contextual('b')]),
        'contextual',
      ),
    ).toEqual({ chunks: 2, contexts: 2, problems: [] })
  })

  it('says when the two are at different commits', () => {
    const { problems } = checkVariantIndex(indexOf([], 'c1'), indexOf([], 'c2'), 'contextual')
    expect(problems).toEqual(['the plain index is at c1, and the contextual one at c2'])
  })

  it('says which chunks only one of them has', () => {
    const { problems } = checkVariantIndex(
      indexOf([plain('a'), plain('gone')]),
      indexOf([contextual('a'), contextual('new')]),
      'contextual',
    )
    expect(problems).toEqual([
      '1 chunks are only in the plain index: gone',
      '1 chunks are only in the contextual index: new',
    ])
  })

  it('says which chunks have another text', () => {
    const { problems } = checkVariantIndex(
      indexOf([plain('a', 'one')]),
      indexOf([contextual('a', 'two')]),
      'contextual',
    )
    expect(problems).toEqual(['1 chunks have another text: a'])
  })

  it.each([
    ['no context', null],
    ['an empty one', '  '],
  ])('counts a chunk with %s as having none', (_, context) => {
    const { contexts, problems } = checkVariantIndex(
      indexOf([plain('a')]),
      indexOf([{ id: 'a', textHash: 'hash a', context }]),
      'contextual',
    )
    expect(contexts).toBe(0)
    expect(problems).toEqual(['1 chunks have no context: a'])
  })

  it('names a few examples and how many more', () => {
    const rows = ['a', 'b', 'c', 'd', 'e'].map((id) => contextual(id))
    const { problems } = checkVariantIndex(indexOf([]), indexOf(rows), 'control')
    expect(problems).toEqual(['5 chunks are only in the control index: a, b, c, and 2 more'])
  })
})
