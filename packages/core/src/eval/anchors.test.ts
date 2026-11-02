import { openSourceIndex, type ChunkWrite, type SourceIndex } from '@docs-rag-lab/db'
import {
  CHUNKER_VERSION,
  chunkDocument,
  type Block,
  type ParsedDoc,
  type Section,
} from '@docs-rag-lab/source-kit'
import { afterEach, describe, expect, it } from 'vitest'

import { fakeVector, paragraph } from '../test-helpers.ts'
import {
  checkGoldenSet,
  parseGoldenLock,
  resolveAnchor,
  sectionAnchorsOf,
  type GoldenLock,
} from './anchors.ts'
import { GoldenSetError, parseGoldenSet, type GoldenQuestion } from './golden.ts'

const prose = (text: string): Block => ({ kind: 'prose', text })
const section = (heading: string, ...blocks: Block[]): Section => ({
  headingPath: [heading],
  anchor: heading.toLowerCase(),
  blocks,
})

const open: SourceIndex[] = []

/** An in-memory index holding what the real chunker makes of these documents. */
function indexOf(documents: Record<string, Section[]>, chunkerVersion = CHUNKER_VERSION) {
  const index = openSourceIndex(':memory:')
  open.push(index)
  const parsed = (sections: Section[]): ParsedDoc => ({
    title: 'Doc',
    url: 'https://x.dev/doc',
    docType: 'handbook',
    sections,
    metadata: {},
  })
  index.applyChanges({
    documents: Object.entries(documents).map(([path, sections]) => ({
      path,
      url: `https://x.dev/${path}`,
      title: path,
      docType: 'handbook',
      contentHash: path,
      lastChangedSha: 's',
      chunks: chunkDocument(path, parsed(sections)).map((chunk): ChunkWrite => ({
        id: chunk.id,
        ordinal: chunk.ordinal,
        headingPath: chunk.headingPath,
        anchor: chunk.anchor,
        blockTypes: chunk.blockTypes,
        text: chunk.text,
        metadata: { anchors: chunk.anchors },
        tokenCount: chunk.tokenCount,
        textHash: chunk.textHash,
        vector: fakeVector(chunk.text, 8),
      })),
    })),
    deletePaths: [],
    manifest: {
      sourceId: 'demo',
      repo: 'r',
      branch: 'main',
      includePaths: [],
      commitSha: 'docs-sha',
      syncedAt: '2026-11-02T00:00:00.000Z',
      embedModel: 'fake:hash:8',
      embedDimensions: 8,
      contextModel: null,
      chunkerVersion,
      parserVersion: 1,
    },
  })
  return index
}

afterEach(() => {
  for (const index of open.splice(0)) index.close()
})

function question(fields: Record<string, unknown>): GoldenQuestion {
  const row = { id: 'ts-0001', question: 'Q?', answer: 'A.', tags: ['basic'], ...fields }
  const [parsed] = parseGoldenSet(JSON.stringify(row))
  if (parsed === undefined) throw new Error('no question')
  return parsed
}

// Three chunks: `long` is split in two, and `packed` shares one chunk with `nested`.
const DOC = {
  'a.md': [
    section(
      'Long',
      prose(`${paragraph(700, 'alpha')} first`),
      prose(`${paragraph(700, 'beta')} second`),
    ),
    section('Packed', prose('Packed text.')),
    { headingPath: ['Packed', 'Nested'], anchor: 'nested', blocks: [prose('Nested text.')] },
  ],
}

describe('resolveAnchor', () => {
  it('matches every part of a section by its own anchor, in document order', () => {
    const index = indexOf(DOC)

    expect(resolveAnchor({ at: 'a.md#long' }, index).chunks).toHaveLength(2)
  })

  it('matches a section inside a chunk that starts elsewhere', () => {
    const index = indexOf(DOC)
    const packed = resolveAnchor({ at: 'a.md#packed' }, index).chunks
    const nested = resolveAnchor({ at: 'a.md#nested' }, index).chunks

    expect(packed).toHaveLength(1)
    expect(nested).toEqual(packed)
  })

  it('matches any chunk of the document without a fragment', () => {
    expect(resolveAnchor({ at: 'a.md' }, indexOf(DOC)).chunks).toHaveLength(3)
  })

  it('narrows a section to the part that holds a pinned passage', () => {
    const index = indexOf(DOC)
    const parts = resolveAnchor({ at: 'a.md#long' }, index).chunks
    const pinned = resolveAnchor({ at: 'a.md#long', contains: 'second' }, index).chunks

    expect(pinned).toEqual([parts?.[1]])
  })

  it('applies a pin to a whole document too', () => {
    const pinned = resolveAnchor({ at: 'a.md', contains: 'Nested text.' }, indexOf(DOC))

    expect(pinned.chunks).toHaveLength(1)
  })

  it('reports the hash of the chunk text, which changes when the text does', () => {
    const before = resolveAnchor({ at: 'a.md#packed' }, indexOf(DOC)).chunks
    const after = resolveAnchor(
      { at: 'a.md#packed' },
      indexOf({ 'a.md': [section('Packed', prose('Other text.'))] }),
    ).chunks

    expect(before?.[0]?.textHash).toMatch(/^[0-9a-f]{64}$/)
    expect(after?.[0]?.textHash).not.toBe(before?.[0]?.textHash)
  })

  it.each([
    ['no-document', { at: 'missing.md' }],
    ['no-section', { at: 'a.md#missing' }],
    ['no-passage', { at: 'a.md#packed', contains: 'not there' }],
  ])('reports %s', (problem, ref) => {
    expect(resolveAnchor(ref, indexOf(DOC))).toEqual({ problem })
  })

  it('does not take a heading-shaped line in code for a section', () => {
    const index = indexOf({
      'c.md': [section('Shell', { kind: 'code', lang: 'sh', code: '# not-a-section' })],
    })

    expect(resolveAnchor({ at: 'c.md#not-a-section' }, index)).toEqual({ problem: 'no-section' })
    expect(resolveAnchor({ at: 'c.md#shell' }, index).chunks).toHaveLength(1)
  })
})

describe('sectionAnchorsOf', () => {
  it('reads recorded anchors and treats anything else as none', () => {
    expect(sectionAnchorsOf({ metadata: { anchors: ['a', 'b'] } })).toEqual(['a', 'b'])
    expect(sectionAnchorsOf({ metadata: { anchors: [1] } })).toEqual([])
    expect(sectionAnchorsOf({ metadata: {} })).toEqual([])
  })
})

describe('checkGoldenSet', () => {
  const lockOf = (index: SourceIndex, questions: GoldenQuestion[]): GoldenLock =>
    checkGoldenSet({ questions, index, lock: undefined }).lock

  it('reports nothing for a golden set that matches its lock', () => {
    const index = indexOf(DOC)
    const questions = [
      question({ primary: ['a.md#long'], acceptable: ['a.md#packed'] }),
      question({ id: 'ts-0002', tags: ['unanswerable'] }),
    ]

    const check = checkGoldenSet({ questions, index, lock: lockOf(index, questions) })

    expect(check).toMatchObject({
      docsSha: 'docs-sha',
      questions: 2,
      unanswerable: 1,
      anchors: 2,
      stale: [],
      review: [],
      findings: [],
    })
  })

  it('says every anchor needs reviewing before there is a lock', () => {
    const questions = [question({ primary: ['a.md#long'] })]

    const check = checkGoldenSet({ questions, index: indexOf(DOC), lock: undefined })

    expect(check.review).toEqual(['ts-0001'])
    expect(check.findings).toMatchObject([{ role: 'primary', problem: 'not-locked' }])
  })

  it('marks a question stale when a primary anchor is gone', () => {
    const questions = [question({ primary: ['a.md#long', 'a.md#missing'] })]

    const check = checkGoldenSet({ questions, index: indexOf(DOC), lock: undefined })

    expect(check.stale).toEqual(['ts-0001'])
    expect(check.review).toEqual([])
    expect(check.findings).toContainEqual({
      questionId: 'ts-0001',
      role: 'primary',
      anchor: { at: 'a.md#missing' },
      problem: 'no-section',
    })
  })

  it('keeps a question with primaryMatch any while one of its anchors is left', () => {
    const one = question({ primary: ['a.md#long', 'a.md#missing'], primaryMatch: 'any' })
    const none = question({
      id: 'ts-0002',
      primary: ['b.md', 'a.md#missing'],
      primaryMatch: 'any',
    })

    const check = checkGoldenSet({ questions: [one, none], index: indexOf(DOC), lock: undefined })

    expect(check.stale).toEqual(['ts-0002'])
    expect(check.review).toEqual(['ts-0001'])
  })

  it('asks for a review, not stale, when only an acceptable anchor is gone', () => {
    const index = indexOf(DOC)
    const questions = [question({ primary: ['a.md#long'], acceptable: ['a.md#missing'] })]

    const check = checkGoldenSet({ questions, index, lock: lockOf(index, questions) })

    expect(check.stale).toEqual([])
    expect(check.review).toEqual(['ts-0001'])
    expect(check.findings).toMatchObject([{ role: 'acceptable', problem: 'no-section' }])
  })

  it('notices text that changed under an anchor that still resolves', () => {
    const questions = [question({ primary: ['a.md#packed'] })]
    const lock = lockOf(indexOf({ 'a.md': [section('Packed', prose('Old text.'))] }), questions)

    const check = checkGoldenSet({
      questions,
      index: indexOf({ 'a.md': [section('Packed', prose('New text.'))] }),
      lock,
    })

    expect(check.stale).toEqual([])
    expect(check.review).toEqual(['ts-0001'])
    expect(check.findings).toMatchObject([{ problem: 'changed' }])
  })

  it('notices a pin that no longer matches', () => {
    const questions = [question({ primary: [{ at: 'a.md#packed', contains: 'Old text' }] })]
    const old = indexOf({ 'a.md': [section('Packed', prose('Old text.'))] })

    const check = checkGoldenSet({
      questions,
      index: indexOf({ 'a.md': [section('Packed', prose('New text.'))] }),
      lock: lockOf(old, questions),
    })

    expect(check.stale).toEqual(['ts-0001'])
    expect(check.findings).toMatchObject([{ problem: 'no-passage' }])
  })

  it('writes a lock of the resolved anchors only, sorted, so it diffs cleanly', () => {
    const questions = [
      question({ primary: ['a.md#packed', 'a.md#long', 'a.md#missing'] }),
      question({ id: 'ts-0002', primary: ['a.md#long'] }),
    ]

    const { lock, anchors } = checkGoldenSet({ questions, index: indexOf(DOC), lock: undefined })

    expect(anchors).toBe(3)
    expect(lock.docsSha).toBe('docs-sha')
    expect(Object.keys(lock.anchors)).toEqual(['a.md#long', 'a.md#packed'])
  })

  it('refuses an index built by another chunker, whose anchors it cannot trust', () => {
    const index = indexOf(DOC, CHUNKER_VERSION - 1)

    expect(() => checkGoldenSet({ questions: [], index, lock: undefined })).toThrow(
      `the index was built with chunker version ${String(CHUNKER_VERSION - 1)} and this code has ${String(CHUNKER_VERSION)}: run drl sync demo`,
    )
  })

  it('refuses an empty index', () => {
    const index = openSourceIndex(':memory:')
    open.push(index)

    expect(() => checkGoldenSet({ questions: [], index, lock: undefined })).toThrow(
      'the index is empty',
    )
  })
})

describe('parseGoldenLock', () => {
  it('reads what checkGoldenSet wrote', () => {
    const index = indexOf(DOC)
    const { lock } = checkGoldenSet({
      questions: [question({ primary: ['a.md#long'] })],
      index,
      lock: undefined,
    })

    expect(parseGoldenLock(JSON.stringify(lock))).toEqual(lock)
  })

  it.each([
    ['text that is not JSON', '{nope', 'not valid JSON'],
    ['a missing SHA', '{"anchors":{}}', 'docsSha and anchors'],
    ['missing anchors', '{"docsSha":"s"}', 'docsSha and anchors'],
    ['a malformed entry', '{"docsSha":"s","anchors":{"a":[{"chunkId":1}]}}', 'docsSha and anchors'],
    ['an empty entry', '{"docsSha":"s","anchors":{"a":[]}}', 'docsSha and anchors'],
  ])('refuses %s', (_name, text, message) => {
    expect(() => parseGoldenLock(text)).toThrow(GoldenSetError)
    expect(() => parseGoldenLock(text)).toThrow(message)
  })
})
