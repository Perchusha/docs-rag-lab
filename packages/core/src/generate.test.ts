import type Anthropic from '@anthropic-ai/sdk'
import type { SearchHit } from '@docs-rag-lab/db'
import { describe, expect, it } from 'vitest'

import { MissingKeyError } from './env.ts'
import {
  ANSWER_SYSTEM_PROMPT,
  buildAnswerRequest,
  citationSource,
  citationTitle,
  CitationNumbering,
  createClaudeClient,
  sectionPathOf,
  streamAnswer,
  toSearchResult,
} from './generate.ts'
import { ANSWER_MESSAGE, fakeAnswerClient } from './test-helpers.ts'

const message = ANSWER_MESSAGE

const text =
  'Everyday Types > Union Types\n\nA union type is...\n\n```ts\nlet id: number | string\n```'
const hit: SearchHit = {
  chunkId: 'c1',
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

describe('citationTitle', () => {
  it('names the section a pack under the document root starts in, not just the document', () => {
    // A real case: By Example.md#organizing-types used to be cited as "Declaration Reference".
    const packed = {
      title: 'Declaration Reference',
      headingPath: [],
      metadata: { sectionPath: ['Organizing Types'] },
    }
    expect(citationTitle(packed)).toBe('Declaration Reference > Organizing Types')
    expect(sectionPathOf(packed)).toEqual(['Organizing Types'])
  })

  it('falls back to the heading path for chunks from before chunker version 3', () => {
    expect(citationTitle(hit)).toBe('Everyday Types > Union Types')
    expect(citationTitle({ ...hit, metadata: { sectionPath: 'not a path' } })).toBe(
      'Everyday Types > Union Types',
    )
  })
})

describe('createClaudeClient', () => {
  it('reads ANTHROPIC_API_KEY itself, so no caller handles the key', () => {
    expect(() => createClaudeClient({})).toThrow(MissingKeyError)
    expect(() => createClaudeClient({})).toThrow(/ANTHROPIC_API_KEY is not set/)
    expect(createClaudeClient({ ANTHROPIC_API_KEY: 'sk-test' }).apiKey).toBe('sk-test')
  })
})

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

const textBlocks = message.content.filter(
  (block): block is Anthropic.TextBlock => block.type === 'text',
)

describe('streamAnswer', () => {
  const request = buildAnswerRequest({
    question: 'q',
    hits: [hit],
    model: 'claude-test',
    effort: 'low',
    maxTokens: 100,
  })

  it('streams text, hands over each finished text block and reports usage once', async () => {
    let text = ''
    const blocks: Anthropic.TextBlock[] = []
    const usages: Anthropic.Usage[] = []

    const final = await streamAnswer(fakeAnswerClient(), request, {
      onText: (delta) => (text += delta),
      onTextBlock: (block) => blocks.push(block),
      onUsage: (usage) => usages.push(usage),
    })

    expect(final).toBe(message)
    expect(text).toBe(textBlocks.map((block) => block.text).join(''))
    expect(blocks).toHaveLength(4)
    expect(usages).toEqual([message.usage])
  })

  it('still reports the usage so far when the stream fails part-way', async () => {
    const usages: Anthropic.Usage[] = []
    await expect(
      streamAnswer(fakeAnswerClient({ failAfterFirstBlock: true }), request, {
        onUsage: (usage) => usages.push(usage),
      }),
    ).rejects.toThrow('connection reset')
    expect(usages.map((usage) => usage.output_tokens)).toEqual([10])
  })

  it('passes the abort signal to the request, and stops when it fires', async () => {
    const controller = new AbortController()
    const client = fakeAnswerClient({
      afterBlock: () => {
        controller.abort()
      },
    })
    let text = ''

    await expect(
      streamAnswer(client, request, { onText: (delta) => (text += delta) }, controller.signal),
    ).rejects.toThrow('aborted')
    expect(client.signals).toEqual([controller.signal])
    expect(text).toBe(textBlocks[0]?.text)
  })
})

describe('citations', () => {
  // Search result i of the request is context[i].
  const context = [{ chunkId: 'narrowing-1' }, { chunkId: 'union-types-1' }]

  it('numbers search results in order of first use, lists each once and names its chunk', () => {
    const numbering = new CitationNumbering(context)
    for (const block of textBlocks) numbering.add(block)
    expect(numbering.list()).toEqual([
      {
        number: 1,
        source: 'https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#union-types',
        title: 'Everyday Types > Union Types',
        citedText: 'A union type is a type formed from two or more other types.',
        chunkId: 'union-types-1',
        contextRank: 2,
      },
      {
        number: 2,
        source: 'https://www.typescriptlang.org/docs/handbook/2/narrowing.html',
        title: 'Narrowing',
        citedText: 'Narrowing occurs when TypeScript can deduce a more specific type.',
        chunkId: 'narrowing-1',
        contextRank: 1,
      },
    ])
  })

  it('returns the markers for each text block as it completes', () => {
    const numbering = new CitationNumbering(context)
    expect(textBlocks.map((block) => numbering.add(block))).toEqual([[1], [], [2, 1], []])
  })

  it('refuses a citation that points outside the context', () => {
    const numbering = new CitationNumbering([{ chunkId: 'only-one' }])
    expect(() => textBlocks.map((block) => numbering.add(block))).toThrow(
      'a citation points to search result 1, but the context has 1',
    )
  })
})
