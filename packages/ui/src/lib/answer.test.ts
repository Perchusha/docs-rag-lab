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

  it('puts a marker that follows a code block on the text before the block', () => {
    const fenced: AnswerPart[] = [
      { kind: 'text', text: 'Example:\n\n```ts\nconst a = 1 satisfies number\n```\n' },
      { kind: 'cite', numbers: [1] },
      { kind: 'text', text: '\nAfter the code.' },
    ]
    expect(answerMarkdown(fenced)).toBe(
      'Example:[1](#cite-1)\n\n```ts\nconst a = 1 satisfies number\n```\n\nAfter the code.',
    )
  })

  it('goes past several code blocks to the text, and into a table row there', () => {
    const cited = (text: string): AnswerPart[] => [
      { kind: 'text', text },
      { kind: 'cite', numbers: [1] },
    ]
    expect(answerMarkdown(cited('Two:\n\n```\na\n```\n\n```\nb\n```'))).toBe(
      'Two:[1](#cite-1)\n\n```\na\n```\n\n```\nb\n```',
    )
    expect(answerMarkdown(cited('| a | b |\n\n```\nc\n```'))).toBe(
      '| a | b[1](#cite-1) |\n\n```\nc\n```',
    )
  })

  it('keeps a line of its own only when nothing comes before the code block', () => {
    const fenced: AnswerPart[] = [
      { kind: 'text', text: '```ts\nconst a = 1\n```' },
      { kind: 'cite', numbers: [1] },
    ]
    expect(answerMarkdown(fenced)).toBe('```ts\nconst a = 1\n```\n\n[1](#cite-1)')
  })

  it('goes on the text before a block still open, never into the code', () => {
    const cited = (text: string): AnswerPart[] => [
      { kind: 'text', text },
      { kind: 'cite', numbers: [2] },
    ]
    expect(answerMarkdown(cited('Text\n```'))).toBe('Text[2](#cite-2)\n```')
    expect(answerMarkdown(cited('Text\n\n```ts\nconst a = 1'))).toBe(
      'Text[2](#cite-2)\n\n```ts\nconst a = 1',
    )
    expect(answerMarkdown(cited('```ts\nconst a = 1'))).toBe('[2](#cite-2)\n\n```ts\nconst a = 1')
  })

  it('skips a rule and a heading underline on the way to the text', () => {
    const cited = (text: string): AnswerPart[] => [
      { kind: 'text', text },
      { kind: 'cite', numbers: [1] },
    ]
    expect(answerMarkdown(cited('Title\n---\n```\na\n```'))).toBe(
      'Title[1](#cite-1)\n---\n```\na\n```',
    )
    expect(answerMarkdown(cited('Title\n===\n```\na\n```'))).toBe(
      'Title[1](#cite-1)\n===\n```\na\n```',
    )
    expect(answerMarkdown(cited('Text\n\n* * *\n\n```\na\n```'))).toBe(
      'Text[1](#cite-1)\n\n* * *\n\n```\na\n```',
    )
    expect(answerMarkdown(cited('---\n```\na\n```'))).toBe('---\n```\na\n```\n\n[1](#cite-1)')
  })

  it('keeps a marker inside the table row it follows, where GFM would drop an extra cell', () => {
    const cited = (text: string): AnswerPart[] => [
      { kind: 'text', text },
      { kind: 'cite', numbers: [1] },
    ]
    expect(answerMarkdown(cited('| a | b |'))).toBe('| a | b[1](#cite-1) |')
    expect(answerMarkdown(cited('| a | b |\n'))).toBe('| a | b[1](#cite-1) |\n')
    expect(answerMarkdown(cited('a | b |'))).toBe('a | b[1](#cite-1) |')
    // In the middle of a cell, the end of the text is already the right place.
    expect(answerMarkdown(cited('| a | b'))).toBe('| a | b[1](#cite-1)')
    // A delimiter row has no cell to hold it, so the header row takes it.
    expect(answerMarkdown(cited('| a | b |\n|---|:-:|'))).toBe('| a | b[1](#cite-1) |\n|---|:-:|')
  })

  it('does not take other text for a table row', () => {
    const cited = (text: string): AnswerPart[] => [
      { kind: 'text', text },
      { kind: 'cite', numbers: [1] },
    ]
    expect(answerMarkdown(cited('a | b \\|'))).toBe('a | b \\|[1](#cite-1)')
    expect(answerMarkdown(cited('Use a pipe |'))).toBe('Use a pipe |[1](#cite-1)')
    expect(answerMarkdown(cited('---'))).toBe('---[1](#cite-1)')
    expect(answerMarkdown(cited('```\n| a | b |'))).toBe('[1](#cite-1)\n\n```\n| a | b |')
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
