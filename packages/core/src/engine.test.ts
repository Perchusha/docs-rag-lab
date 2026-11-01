import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { NO_CONTEXT, type AnswerEvent } from '@docs-rag-lab/contracts'
import type { ChunkWrite } from '@docs-rag-lab/db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createEngine, UnknownSourceError, type EngineSettings } from './engine.ts'
import { openIndexes, sourceIndexPath } from './indexes.ts'
import { fakeAnswerClient, fakeVector, RecordingProvider } from './test-helpers.ts'
import { UsageMeter } from './usage.ts'

const QUESTION = 'What does error TS2345 mean?'

// Engine settings as a host passes them. Core may import only types from
// @docs-rag-lab/settings, so the test builds its own values.
const settings: EngineSettings = {
  dataDir: 'data',
  embeddings: {
    provider: 'voyage',
    endpoint: 'https://ai.example.com/v1',
    model: 'fake-embed',
    dimensions: 8,
    batch: { maxInputs: 10, maxTokens: 1000 },
    rateLimit: { rpm: 1000, tpm: 1_000_000 },
  },
  models: { answer: 'claude-test', contextualize: 'claude-small' },
  answer: { effort: 'low', maxTokens: 100 },
  retrieval: { strategy: 'hybrid', topK: 2, candidates: 10, rrfK: 60 },
  pricing: {
    checked: '2026-11-01',
    sources: [],
    models: { 'claude-test': { input: 2, output: 10 }, 'fake-embed': { input: 0.06 } },
  },
}

const source = {
  id: 'demo',
  repo: 'r',
  branch: 'main',
  include: ['docs'],
  license: { name: 'MIT', url: 'https://example.com', attribution: 'Demo' },
  parserVersion: 1,
  match: () => true,
  parse: () => Promise.reject(new Error('not used')),
  exactTokens: (q: string) => [...q.matchAll(/\bTS(\d+)\b/g)].flatMap((m) => [m[0], m[1] ?? '']),
}

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'drl-engine-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/** Seeds data/sources/demo.sqlite with one document of three chunks. */
function seed(provider: RecordingProvider, texts?: string[]): void {
  const chunk = (id: string, ordinal: number, text: string, vectorOf = text): ChunkWrite => ({
    id,
    ordinal,
    headingPath: [],
    anchor: id,
    blockTypes: ['prose'],
    text,
    metadata: { spans: [[0, text.length]], sectionPath: [`Section ${id}`] },
    tokenCount: 2,
    textHash: id,
    vector: fakeVector(vectorOf, provider.dimensions),
  })
  const chunks = texts?.map((text, i) => chunk(`c${String(i)}`, i, text)) ?? [
    chunk('near', 0, 'Prose about assignability of arguments.', QUESTION),
    chunk('code', 1, 'Example:\n// @errors: 2345\nfn("x")'),
    chunk('other', 2, 'Interfaces and classes.'),
  ]
  const indexes = openIndexes(join(root, settings.dataDir), 'demo')
  indexes.index.applyChanges({
    documents: [
      {
        path: 'docs/a.md',
        url: 'https://x.dev/a',
        title: 'A',
        docType: 'handbook',
        contentHash: 'h',
        lastChangedSha: 's',
        chunks,
      },
    ],
    deletePaths: [],
    manifest: {
      sourceId: 'demo',
      repo: 'r',
      branch: 'main',
      includePaths: ['docs'],
      commitSha: 's',
      syncedAt: '2026-11-01T00:00:00.000Z',
      embedModel: provider.id,
      embedDimensions: provider.dimensions,
      contextModel: null,
      chunkerVersion: 3,
      parserVersion: 1,
    },
  })
  indexes.close()
}

function engine(provider = new RecordingProvider(), client = fakeAnswerClient()) {
  return createEngine({
    settings,
    sources: [source],
    root,
    createProvider: () => provider,
    createClient: () => client,
  })
}

describe('createEngine', () => {
  it('searches with the settings, and a request overrides strategy and top K', async () => {
    const provider = new RecordingProvider()
    seed(provider)
    const meter = new UsageMeter()

    const hybrid = await engine(provider).search({ question: QUESTION }, meter)
    expect(hybrid.trace).toMatchObject({ strategy: 'hybrid', params: { topK: 2 } })
    expect(hybrid.trace.chunks.code?.sectionPath).toEqual(['Section code'])

    const vector = await engine(provider).search(
      { question: QUESTION, strategy: 'vector', topK: 1, docTypes: ['handbook'] },
      meter,
    )
    expect(vector.trace).toMatchObject({ strategy: 'vector', params: { topK: 1 } })
    expect(vector.trace.filters.docTypes).toEqual(['handbook'])
    expect(vector.hits).toHaveLength(1)
    expect(meter.entries().map(([model]) => model)).toEqual(['fake-embed'])
  })

  it('names what is wrong with a request: an unknown source or doc type', async () => {
    seed(new RecordingProvider())
    await expect(
      engine().search({ question: 'q', source: 'react' }, new UsageMeter()),
    ).rejects.toThrow(UnknownSourceError)
    await expect(
      engine().search({ question: 'q', docTypes: ['manual'] }, new UsageMeter()),
    ).rejects.toThrow(
      'unknown doc type "manual" (known: handbook, reference, option, release-notes, other)',
    )
  })

  it('says to sync first when there is no index, and creates no file', async () => {
    await expect(engine().search({ question: 'q' }, new UsageMeter())).rejects.toThrow(
      'there is no index for demo yet: run drl sync demo first',
    )
    expect(existsSync(sourceIndexPath(join(root, settings.dataDir), 'demo'))).toBe(false)
  })

  it('answers as events: the trace, the streamed text, citations of context chunks, then done', async () => {
    const provider = new RecordingProvider()
    seed(provider)
    const client = fakeAnswerClient()
    const events: AnswerEvent[] = []
    const meter = new UsageMeter()
    const controller = new AbortController()

    const { hits } = await engine(provider, client).ask(
      { question: QUESTION },
      { meter, onEvent: (event) => events.push(event), signal: controller.signal },
    )

    expect(events[0]?.type).toBe('trace')
    expect(events.at(-1)).toMatchObject({ type: 'done', stopReason: 'end_turn' })
    const citations = events.flatMap((event) => (event.type === 'citations' ? [event] : []))
    // The fixture cites search result 1, then 0 and 1 again.
    expect(citations.map((event) => event.numbers)).toEqual([[1], [2, 1]])
    expect(citations.flatMap((event) => event.citations.map((c) => [c.number, c.chunkId]))).toEqual(
      [
        [1, hits[1]?.chunkId],
        [2, hits[0]?.chunkId],
      ],
    )
    const text = events.flatMap((event) => (event.type === 'text' ? [event.text] : [])).join('')
    expect(text.length).toBeGreaterThan(0)

    expect(client.requests[0]?.model).toBe('claude-test')
    expect(client.signals).toEqual([controller.signal])
    const done = events.at(-1)
    if (done?.type !== 'done') throw new Error('expected done last')
    expect(done.usage.models.map((m) => [m.model, m.kind])).toEqual([
      ['fake-embed', 'embedding'],
      ['claude-test', 'messages'],
    ])
    expect(done.usage.costUsd).toBeGreaterThan(0)
  })

  it('creates the Claude client before retrieving, so a missing key costs no embedding', async () => {
    const provider = new RecordingProvider()
    seed(provider)
    const broken = createEngine({
      settings,
      sources: [source],
      root,
      createProvider: () => provider,
      createClient: () => {
        throw new Error('ANTHROPIC_API_KEY is not set')
      },
    })

    await expect(
      broken.ask(
        { question: 'a new question' },
        { meter: new UsageMeter(), onEvent: () => undefined },
      ),
    ).rejects.toThrow('ANTHROPIC_API_KEY is not set')
    expect(provider.calls).toHaveLength(0)
  })

  it('ends with no_context and calls no Claude when nothing matches the filter', async () => {
    const provider = new RecordingProvider()
    seed(provider)
    const client = fakeAnswerClient()
    const events: AnswerEvent[] = []

    await engine(provider, client).ask(
      { question: QUESTION, docTypes: ['option'] },
      { meter: new UsageMeter(), onEvent: (event) => events.push(event) },
    )

    expect(events.map((event) => event.type)).toEqual(['trace', 'done'])
    expect(events[1]).toMatchObject({ stopReason: NO_CONTEXT })
    expect(client.requests).toHaveLength(0)
  })

  it('returns a document with its chunks in order, with the section each one starts in', () => {
    seed(new RecordingProvider(), ['First text.', 'Second text.'])

    const document = engine().documentChunks('demo', 'docs/a.md')

    expect(document).toMatchObject({ sourceId: 'demo', path: 'docs/a.md', title: 'A' })
    expect(document?.chunks.map((c) => [c.chunkId, c.ordinal, c.sectionPath, c.spans])).toEqual([
      ['c0', 0, ['Section c0'], [[0, 11]]],
      ['c1', 1, ['Section c1'], [[0, 12]]],
    ])
    expect(engine().documentChunks('demo', 'docs/missing.md')).toBeUndefined()
  })
})
