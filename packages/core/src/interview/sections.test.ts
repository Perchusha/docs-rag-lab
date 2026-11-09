import type { BankQuestion } from '@docs-rag-lab/contracts'
import { chunkDocument, type Chunk, type ParsedDoc, type Section } from '@docs-rag-lab/source-kit'
import { describe, expect, it } from 'vitest'

import type { BankChunk } from './documents.ts'
import { quoteCitation, quotePassage, sectionCitation, withQuoteCitations } from './sections.ts'
import type { BankRow, QuestionRow } from './store.ts'
import { testChunk } from './test-chunks.ts'

const TEXT = {
  a: 'Alpha holds that the first rule applies to every value it is given here.',
  b: 'Beta holds that the second rule applies only when the flag is turned on.',
  x1: 'X one explains how the first challenge is solved with a single state variable.',
  x2: 'X two explains how the second challenge needs an effect and a cleanup function.',
  y: 'Y opens the section with what every subsection below it has in common today.',
  y1: 'Y one goes deeper into the subsection, with the details the overview left out.',
  t: 'T introduces an option whose subsections have headings but no fragments at all.',
  t1: 'T one describes the first value of the option, under a heading with no anchor.',
}

const section = (headingPath: string[], anchor: string, text?: string): Section => ({
  headingPath,
  anchor,
  blocks: text === undefined ? [] : [{ kind: 'prose', text }],
})

// Small enough that the page is cut into packs, as long pages are: A and B together, then X, Y
// and T each on their own.
const doc: ParsedDoc = {
  title: 'Page',
  url: 'https://docs.example.com/page',
  docType: 'handbook',
  metadata: {},
  sections: [
    section(['A'], 'a', TEXT.a),
    section(['B'], 'b', TEXT.b),
    section(['X'], 'x'),
    section(['X', 'X1'], 'x1', TEXT.x1),
    section(['X', 'X2'], 'x2', TEXT.x2),
    section(['Y'], 'y', TEXT.y),
    section(['Y', 'Y1'], 'y1', TEXT.y1),
    section(['T'], 't', TEXT.t),
    section(['T', 'T1'], '', TEXT.t1),
  ],
}

const bankChunk = (chunk: Chunk): BankChunk => ({
  id: chunk.id,
  text: chunk.text,
  textHash: chunk.textHash,
  anchor: chunk.anchor,
  sectionPath: chunk.sectionPath,
  anchors: chunk.anchors,
  spans: chunk.spans,
  compiler: chunk.compiler ?? [],
})

const chunks = chunkDocument('page.md', doc, { maxTokens: 60 }).map(bankChunk)
const chunkWith = (text: string): BankChunk => {
  const found = chunks.find((chunk) => chunk.text.includes(text))
  if (found === undefined) throw new Error(`no chunk holds ${text}`)
  return found
}
const document = { url: doc.url }

describe('sectionCitation (ADR-0018)', () => {
  it('reads chunks as the chunker writes them', () => {
    expect(chunks.map(({ anchor, anchors }) => [anchor, anchors])).toEqual([
      ['a', ['a', 'b']],
      ['x', ['x', 'x1', 'x2']],
      ['y', ['y', 'y1']],
      ['t', ['t']],
    ])
  })

  it('links to the section a quote is in, in a chunk that starts at a heading', () => {
    const chunk = chunkWith(TEXT.b)

    expect(quoteCitation(document, chunk, TEXT.a)).toEqual({
      url: 'https://docs.example.com/page#a',
      sectionPath: ['A'],
    })
    expect(quoteCitation(document, chunk, TEXT.b)).toEqual({
      url: 'https://docs.example.com/page#b',
      sectionPath: ['B'],
    })
  })

  it('links to a subsection, in a chunk whose own heading is not in its text', () => {
    expect(quoteCitation(document, chunkWith(TEXT.x2), TEXT.x2)).toEqual({
      url: 'https://docs.example.com/page#x2',
      sectionPath: ['X', 'X2'],
    })
  })

  it('links to the section the chunk starts in for text above its first heading', () => {
    const chunk = chunkWith(TEXT.y)

    expect(quoteCitation(document, chunk, TEXT.y)).toEqual({
      url: 'https://docs.example.com/page#y',
      sectionPath: ['Y'],
    })
    expect(quoteCitation(document, chunk, TEXT.y1)).toEqual({
      url: 'https://docs.example.com/page#y1',
      sectionPath: ['Y', 'Y1'],
    })
  })

  it('keeps the section the chunk starts in when its headings have no fragment', () => {
    expect(quoteCitation(document, chunkWith(TEXT.t1), TEXT.t1)).toEqual({
      url: 'https://docs.example.com/page#t',
      sectionPath: ['T'],
    })
  })

  it('keeps the section the chunk starts in for a quote it does not hold', () => {
    expect(
      quoteCitation(document, chunkWith(TEXT.b), 'Words that no chunk of the page holds.'),
    ).toEqual({
      url: 'https://docs.example.com/page#a',
      sectionPath: ['A'],
    })
  })

  it('reads a heading only where a span starts, never in code', () => {
    const chunk = chunkWith(TEXT.b)
    const code = '```sh\n## not a heading\n```'
    const inCode: BankChunk = {
      ...chunk,
      text: `${chunk.text}\n\n${code}`,
      spans: [...chunk.spans, [chunk.text.length + 2, chunk.text.length + 2 + code.length]],
    }

    expect(sectionCitation(document, inCode, inCode.text.length - 5)).toEqual({
      url: 'https://docs.example.com/page#b',
      sectionPath: ['B'],
    })
  })
})

describe('quotePassage (ADR-0018)', () => {
  it('gives the section the quote is in, without its heading or the sections around it', () => {
    expect(quotePassage(chunkWith(TEXT.b), TEXT.b)).toEqual({
      blocks: [{ text: TEXT.b, quote: true }],
    })
    expect(quotePassage(chunkWith(TEXT.a), TEXT.a)).toEqual({
      blocks: [{ text: TEXT.a, quote: true }],
    })
    // Above the chunk's first heading, up to it.
    expect(quotePassage(chunkWith(TEXT.y), TEXT.y)).toEqual({
      blocks: [{ text: TEXT.y, quote: true }],
    })
    expect(quotePassage(chunkWith(TEXT.x1), TEXT.x1)).toEqual({
      blocks: [{ text: TEXT.x1, quote: true }],
    })
  })

  it('marks the blocks the quote is in, and keeps the others of its section', () => {
    const code = '```js\nconst n = 1\n```'
    const chunk = testChunk('m', [
      'The first paragraph says what the section is about.',
      'The second paragraph holds the words the question quotes.',
      code,
    ])

    expect(quotePassage(chunk, 'the words the question quotes')).toEqual({
      blocks: [
        { text: 'The first paragraph says what the section is about.', quote: false },
        { text: 'The second paragraph holds the words the question quotes.', quote: true },
        { text: code, quote: false },
      ],
    })
  })

  it('gives none for a quote the chunk does not hold', () => {
    expect(
      quotePassage(chunkWith(TEXT.b), 'Words that no chunk of the page holds.'),
    ).toBeUndefined()
  })
})

describe('withQuoteCitations (ADR-0018)', () => {
  const chunk = chunkWith(TEXT.b)
  const bankDocument = {
    path: 'page.md',
    url: doc.url,
    title: 'Page',
    docType: 'handbook' as const,
    topic: { id: 'page', title: 'Page', group: 'Handbook' },
    chunks,
  }
  const question = (id: string, quote: string | undefined): BankQuestion => ({
    id,
    source: 'demo',
    kind: quote === undefined ? 'compiler-type' : 'theory',
    topicId: 'page',
    prompt: 'Q?',
    answer: 'A.',
    ...(quote === undefined ? {} : { quote }),
    citation: {
      url: 'https://docs.example.com/page#a',
      title: 'Page',
      sectionPath: ['A'],
      docPath: 'page.md',
      chunkId: chunk.id,
    },
    verifiedBy: quote === undefined ? 'compiler' : 'checker',
  })
  const row = (id: string, quote: string | undefined, textHash = chunk.textHash): QuestionRow => ({
    row: 'question',
    status: 'shown',
    textHash,
    question: question(id, quote),
  })

  it('links each kept question to the section its quote is in, and leaves the rest', () => {
    const rows: BankRow[] = [
      row('moved', TEXT.b),
      row('stays', TEXT.a),
      row('changed', TEXT.b, 'an older text'),
      row('compiler', undefined),
      { row: 'chunk', chunkId: chunk.id, textHash: chunk.textHash, questions: 2 },
    ]
    const cited = withQuoteCitations(rows, [bankDocument])

    expect(cited[0]).toEqual({
      ...rows[0],
      question: {
        ...question('moved', TEXT.b),
        citation: {
          ...question('moved', TEXT.b).citation,
          url: 'https://docs.example.com/page#b',
          sectionPath: ['B'],
        },
      },
    })
    expect(cited.slice(1)).toEqual(rows.slice(1))
  })
})
