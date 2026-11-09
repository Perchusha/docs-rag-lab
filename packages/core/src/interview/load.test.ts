import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { BankQuestion } from '@docs-rag-lab/contracts'
import { CHUNKER_VERSION, type Source } from '@docs-rag-lab/source-kit'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { openIndexes } from '../indexes.ts'
import { loadInterviewBank } from './load.ts'
import { bankPath, writeBank, type BankRow } from './store.ts'

let root: string

const source = (id: string, compiled: boolean): Source => {
  const base: Source = {
    id,
    repo: 'r',
    branch: 'b',
    include: [],
    license: { name: 'l', url: 'u', attribution: 'a' },
    parserVersion: 1,
    match: () => true,
    parse: () => Promise.reject(new Error('not parsed in this test')),
    interviewTopic: ({ path, title }) =>
      path.endsWith('skip.md') ? undefined : { id: path, title, group: 'Handbook' },
  }
  return compiled ? { ...base, compiled: () => ({ ...base, compiler: 'c' }) } : base
}

function seedIndex(sourceId: string, variant?: 'compiled'): void {
  // Two sections, as the chunker writes them: a span per block, the heading joined to its block.
  const intro = (id: string) => `Intro of ${id}.`
  const later = (id: string) => `## Later\n\nText of ${id}, which a quoted question rests on.`
  const chunk = (id: string, ordinal: number) => {
    const head = `Page > ${id}\n\n`
    const second = head.length + intro(id).length + 2
    return {
      id,
      ordinal,
      headingPath: [],
      anchor: '',
      blockTypes: ['prose'],
      text: `${head}${intro(id)}\n\n${later(id)}`,
      context: null,
      metadata: {
        spans: [
          [head.length, head.length + intro(id).length],
          [second, second + later(id).length],
        ],
      },
      tokenCount: 3,
      textHash: `hash-${id}`,
      vector: new Float32Array(4),
    }
  }
  const document = (path: string, ids: string[]) => ({
    path,
    url: `https://x.dev/${path}`,
    title: `Title of ${path}`,
    docType: 'handbook',
    contentHash: 'h',
    lastChangedSha: 's',
    chunks: ids.map(chunk),
  })
  const indexes = openIndexes(
    join(root, 'data'),
    sourceId,
    variant === undefined ? {} : { variant },
  )
  indexes.index.applyChanges({
    documents: [document('a.md', ['a1', 'a2']), document('skip.md', ['s1'])],
    deletePaths: [],
    manifest: {
      sourceId,
      repo: 'r',
      branch: 'b',
      includePaths: [],
      commitSha: 'sha',
      syncedAt: '2026-11-08T00:00:00.000Z',
      embedModel: 'fake:4',
      embedDimensions: 4,
      contextModel: null,
      chunkerVersion: CHUNKER_VERSION,
      parserVersion: 1,
    },
  })
  indexes.close()
}

const question = (id: string, chunkId: string): BankQuestion => ({
  id,
  source: 'typescript',
  kind: 'compiler-type',
  topicId: 'a.md',
  prompt: 'Q?',
  answer: 'A.',
  citation: { url: 'u', title: 't', sectionPath: [], docPath: 'a.md', chunkId },
  verifiedBy: 'compiler',
})

const generated = (id: string, chunkId: string, quote: string): BankQuestion => ({
  ...question(id, chunkId),
  kind: 'theory',
  quote,
  verifiedBy: 'checker',
})

const rows: BankRow[] = [
  { row: 'question', status: 'shown', textHash: 'hash-a1', question: question('shown', 'a1') },
  {
    row: 'question',
    status: 'shown',
    textHash: 'hash-a1',
    question: generated('quoted', 'a1', 'which a quoted question rests on'),
  },
  {
    row: 'question',
    status: 'shown',
    textHash: 'hash-a1',
    question: generated('unquoted', 'a1', 'words that the chunk does not hold'),
  },
  {
    row: 'question',
    status: 'dropped-check',
    textHash: 'hash-a1',
    question: question('dropped', 'a1'),
  },
  { row: 'question', status: 'shown', textHash: 'old-hash', question: question('stale', 'a2') },
  { row: 'question', status: 'shown', textHash: 'hash-gone', question: question('gone', 'gone') },
  { row: 'chunk', chunkId: 'a1', textHash: 'hash-a1', questions: 2 },
]

const header = (variant: 'plain' | 'compiled') => ({
  version: 1 as const,
  source: 'typescript',
  variant,
  docsCommit: 'sha',
  generator: 'g',
  checker: 'c',
})

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'interview-load-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('loadInterviewBank (ADR-0018)', () => {
  it('gives the topics in scope and the shown questions whose chunk has not changed', () => {
    seedIndex('typescript', 'compiled')
    writeBank(bankPath(root, 'typescript'), header('compiled'), rows)

    const bank = loadInterviewBank({
      root,
      dataDir: join(root, 'data'),
      sources: [source('typescript', true)],
    })
    expect(bank.topics).toEqual([
      { source: 'typescript', id: 'a.md', title: 'Title of a.md', group: 'Handbook' },
    ])
    expect(bank.questions.map(({ id }) => id)).toEqual(['quoted', 'shown', 'unquoted'])
  })

  it('gives each generated question the section of its chunk its quote is in', () => {
    seedIndex('typescript', 'compiled')
    writeBank(bankPath(root, 'typescript'), header('compiled'), rows)

    const bank = loadInterviewBank({
      root,
      dataDir: join(root, 'data'),
      sources: [source('typescript', true)],
    })
    expect([...(bank.passages ?? [])]).toEqual([
      [
        'quoted',
        { blocks: [{ text: 'Text of a1, which a quoted question rests on.', quote: true }] },
      ],
    ])
  })

  it('reads the index the bank was built from', () => {
    seedIndex('typescript')
    writeBank(bankPath(root, 'typescript'), header('plain'), rows)

    const bank = loadInterviewBank({
      root,
      dataDir: join(root, 'data'),
      sources: [source('typescript', true)],
    })
    expect(bank.questions.map(({ id }) => id)).toEqual(['quoted', 'shown', 'unquoted'])
  })

  it('has nothing for a source with no bank, no index or no topics', () => {
    seedIndex('react')
    writeBank(bankPath(root, 'typescript'), header('compiled'), rows)
    const noTopics = { ...source('other', false), interviewTopic: undefined }

    const bank = loadInterviewBank({
      root,
      dataDir: join(root, 'data'),
      sources: [source('typescript', true), source('react', false), noTopics],
    })
    expect(bank).toEqual({ topics: [], questions: [], passages: new Map() })
  })
})
