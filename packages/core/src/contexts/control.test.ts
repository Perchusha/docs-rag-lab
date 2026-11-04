import { describe, expect, it } from 'vitest'

import { controlContexts, headingPrefix } from './control.ts'

describe('headingPrefix', () => {
  it('joins the document title and the section path', () => {
    expect(headingPrefix('Everyday Types', ['Unions', 'Narrowing'])).toBe(
      'Everyday Types > Unions > Narrowing',
    )
  })

  it('is the title alone for a chunk under the document root', () => {
    expect(headingPrefix('Everyday Types', [])).toBe('Everyday Types')
  })
})

describe('controlContexts', () => {
  it('gives every chunk its own prefix, from its section and not its heading path', () => {
    const chunk = (id: string, sectionPath: string[]) => ({
      id,
      text: 'Text.',
      textHash: 'h',
      sectionPath,
    })
    expect(
      controlContexts([
        { path: 'a.md', title: 'A', chunks: [chunk('a1', []), chunk('a2', ['One'])] },
        { path: 'b.md', title: 'B', chunks: [chunk('b1', ['Two', 'Three'])] },
      ]),
    ).toEqual(
      new Map([
        ['a1', 'A'],
        ['a2', 'A > One'],
        ['b1', 'B > Two > Three'],
      ]),
    )
  })

  it('calls nothing and is the same every time, so nothing needs committing', () => {
    const documents = [
      {
        path: 'a.md',
        title: 'A',
        chunks: [{ id: 'a1', text: 'Text.', textHash: 'h', sectionPath: ['One'] }],
      },
    ]
    expect(controlContexts(documents)).toEqual(controlContexts(documents))
  })
})
