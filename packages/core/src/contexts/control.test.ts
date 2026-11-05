import { describe, expect, it } from 'vitest'

import {
  CONTROL_IDENTITY,
  controlContexts,
  headingPrefix,
  variantOfContextModel,
} from './control.ts'

describe('variantOfContextModel', () => {
  it('tells which index a report measured, from what wrote its contexts', () => {
    expect(variantOfContextModel(null)).toBeUndefined()
    expect(variantOfContextModel(CONTROL_IDENTITY)).toBe('control')
    expect(variantOfContextModel('claude-haiku-5-5:75010bc9e7d5')).toBe('contextual')
    expect(variantOfContextModel('compiler:twoslash 0.3.9, typescript 6.0.2')).toBe('compiled')
  })
})

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
