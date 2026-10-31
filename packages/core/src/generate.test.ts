import { readFileSync } from 'node:fs'

import type Anthropic from '@anthropic-ai/sdk'
import type { SearchHit } from '@docs-rag-lab/db'
import { describe, expect, it } from 'vitest'

import {
  ANSWER_SYSTEM_PROMPT,
  buildAnswerRequest,
  citationSource,
  CitationNumbering,
  collectCitations,
  toSearchResult,
} from './generate.ts'

// Hand-built in the shape of the search results docs: two cited search
// results, one cited twice, plus uncited text and an empty thinking block.
const message = JSON.parse(
  readFileSync(new URL('./__fixtures__/answer-message.json', import.meta.url), 'utf8'),
) as Anthropic.Message

const text =
  'Everyday Types > Union Types\n\nA union type is...\n\n```ts\nlet id: number | string\n```'
const hit: SearchHit = {
  chunkId: 'c1',
  distance: 0.1,
  text,
  headingPath: ['Union Types'],
  anchor: 'union-types',
  blockTypes: ['prose', 'code'],
  metadata: {
    spans: [
      [30, 48],
      [50, text.length],
    ],
  },
  tokenCount: 20,
  docPath: 'handbook-v2/Everyday Types.md',
  url: 'https://www.typescriptlang.org/docs/handbook/2/everyday-types.html',
  title: 'Everyday Types',
  docType: 'handbook',
}

describe('toSearchResult', () => {
  it('sends one citable text block per span, with the anchored URL and heading path', () => {
    expect(toSearchResult(hit)).toEqual({
      type: 'search_result',
      source: 'https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#union-types',
      title: 'Everyday Types > Union Types',
      content: [
        { type: 'text', text: 'A union type is...' },
        { type: 'text', text: '```ts\nlet id: number | string\n```' },
      ],
      citations: { enabled: true },
    })
  })

  it('falls back to the text after the prefix line when spans are missing', () => {
    expect(toSearchResult({ ...hit, metadata: {} }).content).toEqual([
      { type: 'text', text: text.slice(text.indexOf('\n\n') + 2) },
    ])
  })
})

describe('citationSource', () => {
  it('appends the anchor unless there is none or the URL already has a fragment', () => {
    expect(citationSource({ url: 'https://x.dev/a.html', anchor: 'b' })).toBe(
      'https://x.dev/a.html#b',
    )
    expect(citationSource({ url: 'https://x.dev/a.html', anchor: '' })).toBe('https://x.dev/a.html')
    expect(citationSource({ url: 'https://x.dev/tsconfig/#type-include', anchor: 'x' })).toBe(
      'https://x.dev/tsconfig/#type-include',
    )
  })
})

describe('buildAnswerRequest', () => {
  it('puts the search results before the question and sends no sampling parameters', () => {
    const request = buildAnswerRequest({
      question: 'What is a union type?',
      hits: [hit, { ...hit, chunkId: 'c2', anchor: '' }],
      model: 'claude-test',
      effort: 'low',
      maxTokens: 1000,
    })

    expect(request).toMatchObject({
      model: 'claude-test',
      max_tokens: 1000,
      system: ANSWER_SYSTEM_PROMPT,
      output_config: { effort: 'low' },
    })
    expect(request).not.toHaveProperty('temperature')
    const content = request.messages[0]?.content
    if (!Array.isArray(content)) throw new Error('expected content blocks')
    expect(content.map((block) => block.type)).toEqual(['search_result', 'search_result', 'text'])
    expect(content[2]).toEqual({ type: 'text', text: 'What is a union type?' })
  })
})

describe('citations', () => {
  it('numbers search results in order of first use and lists each once', () => {
    expect(collectCitations(message)).toEqual([
      {
        number: 1,
        source: 'https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#union-types',
        title: 'Everyday Types > Union Types',
        citedText: 'A union type is a type formed from two or more other types.',
      },
      {
        number: 2,
        source: 'https://www.typescriptlang.org/docs/handbook/2/narrowing.html',
        title: 'Narrowing',
        citedText: 'Narrowing occurs when TypeScript can deduce a more specific type.',
      },
    ])
  })

  it('returns the markers for each text block as it completes', () => {
    const numbering = new CitationNumbering()
    const markers = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => numbering.add(block))
    expect(markers).toEqual([[1], [], [2, 1], []])
  })
})
