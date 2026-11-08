import type { StoredDocument } from '@docs-rag-lab/db'
import type { Source } from '@docs-rag-lab/source-kit'
import { describe, expect, it } from 'vitest'

import { bankDocuments, citationUrl, type BankIndex } from './documents.ts'

const stored = (path: string, docType: string): StoredDocument => ({
  path,
  url: `https://docs.example.com/${path}`,
  title: `Title of ${path}`,
  docType,
  chunks: [
    {
      chunkId: `${path}#0`,
      ordinal: 0,
      headingPath: [],
      anchor: 'intro',
      blockTypes: ['prose'],
      text: 'Title > Intro\n\nText.',
      context: null,
      metadata: {
        sectionPath: ['Intro'],
        spans: [[15, 20]],
        compiler: [{ errors: [], queries: [] }],
      },
      tokenCount: 5,
    },
  ],
})

const documents = [
  stored('b.md', 'handbook'),
  stored('a.md', 'reference'),
  stored('notes.md', 'release-notes'),
]

const index: BankIndex = {
  documentPaths: () => documents.map(({ path }) => path),
  documentChunks: (path) => documents.find((document) => document.path === path),
  chunkHashes: (path) => new Map([[`${path}#0`, `hash of ${path}`]]),
}

const source = (topics: boolean): Source => ({
  id: 'demo',
  repo: 'r',
  branch: 'b',
  include: [],
  license: { name: 'l', url: 'u', attribution: 'a' },
  parserVersion: 1,
  match: () => true,
  parse: () => Promise.reject(new Error('not parsed in this test')),
  ...(topics
    ? {
        interviewTopic: ({ path, docType, title }) =>
          docType === 'release-notes' ? undefined : { id: path, title, group: docType },
      }
    : {}),
})

describe('bankDocuments (ADR-0018)', () => {
  it('reads the documents the source places in its topic map, in path order', () => {
    const found = bankDocuments(source(true), index)

    expect(found.map(({ path }) => path)).toEqual(['a.md', 'b.md'])
    expect(found[0]).toEqual({
      path: 'a.md',
      url: 'https://docs.example.com/a.md',
      title: 'Title of a.md',
      docType: 'reference',
      topic: { id: 'a.md', title: 'Title of a.md', group: 'reference' },
      chunks: [
        {
          id: 'a.md#0',
          text: 'Title > Intro\n\nText.',
          textHash: 'hash of a.md',
          anchor: 'intro',
          sectionPath: ['Intro'],
          spans: [[15, 20]],
          compiler: [{ errors: [], queries: [] }],
        },
      ],
    })
  })

  it('reads nothing for a source without a topic map', () => {
    expect(bankDocuments(source(false), index)).toEqual([])
  })
})

describe('citationUrl', () => {
  it('points at the section when the chunk has an anchor', () => {
    expect(citationUrl({ url: 'https://x.dev/p' }, { anchor: 'a' })).toBe('https://x.dev/p#a')
    expect(citationUrl({ url: 'https://x.dev/p' }, { anchor: '' })).toBe('https://x.dev/p')
  })
})
