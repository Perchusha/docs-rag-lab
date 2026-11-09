import { describe, expect, it } from 'vitest'

import { testChunk } from './test-chunks.ts'
import { calloutsOf, quoteAt, quoteForm, quoteFound, withoutEmDash } from './text.ts'

const EM_DASH = String.fromCodePoint(0x2014)
const EN_DASH = String.fromCodePoint(0x2013)
const CURLY_OPEN = String.fromCodePoint(0x201c)
const CURLY_CLOSE = String.fromCodePoint(0x201d)

describe('withoutEmDash', () => {
  it('turns each em dash into a hyphen, as the bank holds none', () => {
    expect(withoutEmDash(`a${EM_DASH}b${EM_DASH}c`)).toBe('a-b-c')
  })
})

describe('quoteFound (ADR-0018)', () => {
  const chunk = `Narrowing > typeof\n\nTypeScript knows that \`typeof x === "string"\` narrows \`x\` to **string**${EM_DASH}inside the block.`

  it('finds a quote whatever its whitespace, backticks, emphasis, dashes and quotes', () => {
    expect(quoteFound('TypeScript knows that typeof x === "string" narrows x', chunk)).toBe(true)
    expect(quoteFound(`narrows x to string${EN_DASH}inside   the block.`, chunk)).toBe(true)
    expect(
      quoteFound(`knows that typeof x === ${CURLY_OPEN}string${CURLY_CLOSE} narrows`, chunk),
    ).toBe(true)
  })

  it('does not find words the chunk does not hold', () => {
    expect(quoteFound('TypeScript knows that typeof x always narrows', chunk)).toBe(false)
  })

  it('takes no quote too short to support anything', () => {
    expect(quoteFound('narrows', chunk)).toBe(false)
    expect(quoteForm('  a  `b`\n*c*  ')).toBe('a b c')
  })
})

describe('quoteAt (ADR-0018)', () => {
  const chunk = `Narrowing > typeof\n\nTypeScript knows that \`typeof x === "string"\` narrows \`x\` to **string**${EM_DASH}inside the block.\n\nMore text after it.`

  it('finds the quote where the quote check does, as offsets in the text', () => {
    const at = quoteAt('knows that typeof x === "string" narrows x to string-inside', chunk)

    expect(at).toBeDefined()
    expect(chunk.slice(at?.start, at?.end)).toBe(
      `knows that \`typeof x === "string"\` narrows \`x\` to **string**${EM_DASH}inside`,
    )
  })

  it('agrees with the quote check on what it finds', () => {
    for (const quote of [
      `narrows x to string${EN_DASH}inside   the block.`,
      `the block. More text`,
      'TypeScript knows that typeof x always narrows',
      'narrows',
    ]) {
      expect(quoteAt(quote, chunk) !== undefined).toBe(quoteFound(quote, chunk))
    }
  })
})

describe('calloutsOf', () => {
  const pitfall = '[Pitfall]\n\nDo not call hooks in loops.\n\n```js\nfor (;;) useState()\n```'
  const chunk = testChunk('c', [
    'Prose before.',
    `### Heading\n\n${pitfall}`,
    '[Note]\n\nA note.',
    'Prose that says [Pitfall] in the middle.',
  ])

  it('gives each callout of a kind, from its label to the end of its block', () => {
    expect(calloutsOf(chunk.text, chunk.spans, 'Pitfall')).toEqual([pitfall])
    expect(calloutsOf(chunk.text, chunk.spans, 'Note')).toEqual(['[Note]\n\nA note.'])
    expect(calloutsOf(chunk.text, chunk.spans, 'Deep Dive')).toEqual([])
  })
})
