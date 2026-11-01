import { describe, expect, it } from 'vitest'

import { answerFixture } from '../fixtures.ts'
import {
  answerMarkdown,
  appendCitations,
  appendText,
  citationNumber,
  type AnswerPart,
} from './answer.ts'

describe('appendText and appendCitations', () => {
  it('merge text deltas and keep markers between them', () => {
    let parts: AnswerPart[] = []
    parts = appendText(parts, 'The ')
    parts = appendText(parts, 'operator')
    parts = appendCitations(parts, [1])
    parts = appendCitations(parts, [])
    parts = appendText(parts, '.')
    expect(parts).toEqual([
      { kind: 'text', text: 'The operator' },
      { kind: 'cite', numbers: [1] },
      { kind: 'text', text: '.' },
    ])
  })
})

describe('answerMarkdown', () => {
  it('puts each marker right after its text, before trailing whitespace', () => {
    const parts: AnswerPart[] = [
      { kind: 'text', text: 'First claim.\n\n' },
      { kind: 'cite', numbers: [2, 1] },
      { kind: 'text', text: 'Second claim' },
      { kind: 'cite', numbers: [3] },
    ]
    expect(answerMarkdown(parts)).toBe(
      'First claim.[2](#cite-2)[1](#cite-1)\n\nSecond claim[3](#cite-3)',
    )
  })

  it('renders the recorded answer with both of its markers', () => {
    const markdown = answerMarkdown(answerFixture.parts)
    expect(markdown).toContain('introduced in TypeScript 4.9.[1](#cite-1)')
    expect(markdown.match(/\(#cite-1\)/g)).toHaveLength(2)
  })
})

describe('citationNumber', () => {
  it('reads only the links answerMarkdown makes', () => {
    expect(citationNumber('#cite-12')).toBe(12)
    expect(citationNumber('#cite-0')).toBeUndefined()
    expect(citationNumber('#cite-1x')).toBeUndefined()
    expect(citationNumber('https://example.com/#cite-1')).toBeUndefined()
    expect(citationNumber(undefined)).toBeUndefined()
  })
})
