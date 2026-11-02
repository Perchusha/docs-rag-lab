import { describe, expect, it } from 'vitest'

import { chunkLabel } from './trace.ts'

describe('chunkLabel', () => {
  it('names the document and the section a chunk starts in', () => {
    expect(chunkLabel({ title: 'Doc', sectionPath: ['A', 'B'], part: null })).toBe('Doc > A > B')
    expect(chunkLabel({ title: 'Doc', sectionPath: [], part: null })).toBe('Doc')
  })

  it('says which part of its section a chunk is, so a long section does not read the same', () => {
    expect(chunkLabel({ title: 'Doc', sectionPath: ['A'], part: { index: 2, total: 3 } })).toBe(
      'Doc > A (part 2 of 3)',
    )
  })
})
