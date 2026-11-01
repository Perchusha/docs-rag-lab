import type { Strategy } from '@docs-rag-lab/contracts'
import { openEmbeddingCache, openSourceIndex, type ChunkWrite } from '@docs-rag-lab/db'
import type { RetrievalSettings } from '@docs-rag-lab/settings'
import { describe, expect, expectTypeOf, it } from 'vitest'

import { retrieve, type RetrieveOptions } from './retrieve.ts'
import { fuseRrf } from './rrf.ts'
import { fakeVector, RecordingProvider } from './test-helpers.ts'
import { UsageMeter } from './usage.ts'

const QUESTION = 'What does error TS2345 mean?'

// TS-style source hook: TS2345 is written 2345 in the docs.
const source = {
  id: 'demo',
  exactTokens: (q: string) => [...q.matchAll(/\bTS(\d+)\b/g)].flatMap((m) => [m[0], m[1] ?? '']),
}

const settings = (overrides: Partial<RetrievalSettings> = {}): RetrievalSettings => ({
  strategy: 'hybrid',
  topK: 2,
  candidates: 10,
  rrfK: 60,
  ...overrides,
})

function seeded(provider: RecordingProvider) {
  const index = openSourceIndex(':memory:')
  const cache = openEmbeddingCache(':memory:')
  const chunk = (id: string, text: string, vectorOf = text): ChunkWrite => ({
    id,
    ordinal: 0,
    headingPath: [id],
    anchor: id,
    blockTypes: ['prose'],
    text,
    metadata: {},
    tokenCount: 2,
    textHash: id,
    vector: fakeVector(vectorOf, provider.dimensions),
  })
  const doc = (path: string, docType: string, chunks: ChunkWrite[]) => ({
    path,
    url: `https://x.dev/${path}`,
    title: path.toUpperCase(),
    docType,
    contentHash: path,
    lastChangedSha: 's',
    chunks,
  })
  index.applyChanges({
    documents: [
      doc('a.md', 'handbook', [
        // Nearest to the question's vector, but shares no word with it.
        chunk('near', 'Prose about assignability of arguments.', QUESTION),
        // The only chunk with the error code, far from the question in vector space.
        chunk('code', 'Example:\n// @errors: 2345\nfn("x")'),
        chunk('filler1', 'Interfaces and classes.'),
        chunk('filler2', 'Generics with constraints.'),
      ]),
      doc('o.md', 'option', [
        chunk('opt1', 'An option that reports an error for unused labels.'),
        chunk('opt2', 'An option about module resolution.'),
      ]),
    ],
    deletePaths: [],
    manifest: {
      sourceId: 'demo',
      repo: 'r',
      branch: 'main',
      includePaths: ['docs'],
      commitSha: 's',
      syncedAt: '2026-10-31T00:00:00.000Z',
      embedModel: provider.id,
      embedDimensions: provider.dimensions,
      contextModel: null,
      chunkerVersion: 1,
      parserVersion: 1,
    },
  })
  return { index, cache }
}

function options(
  provider: RecordingProvider,
  overrides: Partial<RetrieveOptions> = {},
): RetrieveOptions {
  return {
    question: QUESTION,
    source,
    settings: settings(),
    provider,
    meter: new UsageMeter(),
    ...seeded(provider),
    ...overrides,
  }
}

describe('retrieve', () => {
  it('takes the same strategies from settings that the trace records', () => {
    // settings is a leaf and cannot import contracts, so it repeats the union.
    expectTypeOf<RetrievalSettings['strategy']>().toEqualTypeOf<Strategy>()
  })

  it('vector: returns the nearest chunks and a trace with one list and no fusion', async () => {
    const provider = new RecordingProvider()
    const { hits, trace } = await retrieve(
      options(provider, { settings: settings({ strategy: 'vector' }) }),
    )

    expect(hits[0]?.chunkId).toBe('near')
    expect(hits).toHaveLength(2)
    expect(trace.lists.map((list) => list.name)).toEqual(['vector'])
    expect(trace.lists[0]?.scoring).toBe('cosine-distance')
    expect(trace.lists[0]?.candidates).toHaveLength(6)
    expect(trace.lists[0]?.candidates[0]).toMatchObject({ chunkId: 'near', rank: 1 })
    expect(trace.lists[0]?.candidates[0]?.score).toBeCloseTo(0, 5)
    expect(trace.fusion).toEqual({ method: 'none' })
    expect(trace.context.map((c) => c.chunkId)).toEqual(hits.map((hit) => hit.chunkId))
  })

  it('hybrid: the exact-token list lifts the chunk with the error code above vector neighbours', async () => {
    const provider = new RecordingProvider()
    const { hits, trace } = await retrieve(options(provider))

    expect(trace.query.exactTokens).toEqual([
      { token: 'TS2345', from: 'source' },
      { token: '2345', from: 'source' },
    ])
    const [vector, keyword, exact] = trace.lists
    expect(trace.lists.map((list) => list.name)).toEqual(['vector', 'keyword', 'exact'])
    expect(keyword).toMatchObject({
      scoring: 'bm25',
      query: '"error" OR "ts2345" OR "mean" OR "2345"',
    })
    expect(exact).toMatchObject({ query: '"TS2345" OR "2345"' })
    expect(exact?.candidates.map((c) => c.chunkId)).toEqual(['code'])
    expect(keyword?.candidates.map((c) => c.chunkId)).toContain('code')
    expect(vector?.candidates[0]?.chunkId).toBe('near')

    expect(hits.map((hit) => hit.chunkId)[0]).toBe('code')
    expect(hits).toHaveLength(2)
    if (trace.fusion.method !== 'rrf') throw new Error('expected RRF')
    expect(trace.fusion.k).toBe(60)
    expect(trace.fusion.ranked[0]).toMatchObject({
      chunkId: 'code',
      ranks: { keyword: 1, exact: 1 },
    })
    // Every candidate of every list is described, and the context carries the text.
    const all = new Set(trace.lists.flatMap((list) => list.candidates.map((c) => c.chunkId)))
    expect(Object.keys(trace.chunks).sort()).toEqual([...all].sort())
    expect(trace.chunks.code).toMatchObject({
      docPath: 'a.md',
      docType: 'handbook',
      anchor: 'code',
    })
    expect(trace.context[0]).toMatchObject({
      rank: 1,
      chunkId: 'code',
      source: 'https://x.dev/a.md#code',
      title: 'A.MD > code',
    })
    expect(trace.context[0]?.text).toContain('@errors: 2345')
  })

  it('hybrid with an empty exact list ranks exactly as without one', async () => {
    const question = 'Which option reports unused labels?'
    const provider = new RecordingProvider()
    // No exact tokens: the exact list is skipped.
    const without = await retrieve(options(provider, { question }))
    // An exact token that matches no chunk: the exact list runs and comes back empty.
    const empty = await retrieve(
      options(provider, { question, source: { id: 'demo', exactTokens: () => ['zzqqzz'] } }),
    )

    expect(without.trace.lists.find((list) => list.name === 'exact')).toMatchObject({
      skipped: 'no exact tokens in the question',
      candidates: [],
    })
    const exact = empty.trace.lists.find((list) => list.name === 'exact')
    expect(exact).toMatchObject({ query: '"zzqqzz"', candidates: [] })
    expect(exact?.skipped).toBeUndefined()
    if (without.trace.fusion.method !== 'rrf' || empty.trace.fusion.method !== 'rrf') {
      throw new Error('expected RRF')
    }
    expect(empty.trace.fusion.ranked).toEqual(without.trace.fusion.ranked)
    expect(empty.hits.map((hit) => hit.chunkId)).toEqual(without.hits.map((hit) => hit.chunkId))
    // And both are the two-list fusion of vector and keyword.
    const twoLists = without.trace.lists
      .filter((list) => list.skipped === undefined)
      .map((list) => ({ name: list.name, chunkIds: list.candidates.map((c) => c.chunkId) }))
    expect(twoLists.map((list) => list.name)).toEqual(['vector', 'keyword'])
    expect(without.trace.fusion.ranked).toEqual(fuseRrf(twoLists, 60))
  })

  it('skips the keyword lists when the question has no search terms', async () => {
    const provider = new RecordingProvider()
    const { hits, trace } = await retrieve(options(provider, { question: 'What is it?' }))
    expect(
      trace.lists.filter((list) => list.skipped !== undefined).map((list) => list.name),
    ).toEqual(['keyword', 'exact'])
    expect(hits[0]?.chunkId).toBe(trace.lists[0]?.candidates[0]?.chunkId)
  })

  it('applies the doc type filter to every list', async () => {
    const provider = new RecordingProvider()
    const { hits, trace } = await retrieve(options(provider, { docTypes: ['option'] }))

    expect(trace.filters).toEqual({ docTypes: ['option'] })
    expect(hits.map((hit) => hit.docType)).toEqual(['option', 'option'])
    expect(Object.values(trace.chunks).every((chunk) => chunk.docType === 'option')).toBe(true)
    expect(trace.lists.find((list) => list.name === 'exact')?.candidates).toEqual([])
  })

  it('embeds the question once, as a query, through the cache, and says where the vector came from', async () => {
    const provider = new RecordingProvider()
    const base = options(provider)
    const first = await retrieve(base)
    const second = await retrieve(base)

    expect(provider.calls).toEqual([{ texts: [QUESTION], inputType: 'query' }])
    expect(first.trace.embedding).toMatchObject({ provider: provider.id, from: 'api' })
    expect(second.trace.embedding.from).toBe('cache')
  })

  it('returns a versioned trace that survives JSON, with timings from the clock', async () => {
    const provider = new RecordingProvider()
    let tick = 0
    const { trace } = await retrieve(options(provider, { now: () => (tick += 5) }))

    expect(JSON.parse(JSON.stringify(trace))).toEqual(trace)
    expect(trace).toMatchObject({
      version: 2,
      question: QUESTION,
      sourceId: 'demo',
      strategy: 'hybrid',
      params: { topK: 2, candidates: 10, rrfK: 60 },
    })
    expect(trace.embedding.ms).toBe(5)
    expect(trace.lists.map((list) => list.ms)).toEqual([5, 5, 5])
    expect(trace.totalMs).toBeGreaterThan(trace.embedding.ms)
  })

  it('makes every list at least topK deep', async () => {
    const provider = new RecordingProvider()
    const { hits } = await retrieve(
      options(provider, { settings: settings({ strategy: 'vector', topK: 5, candidates: 1 }) }),
    )
    expect(hits).toHaveLength(5)
  })

  it('refuses an index built with another embedding model', async () => {
    const built = new RecordingProvider({ dimensions: 8 })
    await expect(
      retrieve({ ...options(built), provider: new RecordingProvider({ dimensions: 4 }) }),
    ).rejects.toThrow('built with fake:hash:8')
  })

  it('refuses an empty index', async () => {
    await expect(
      retrieve({
        ...options(new RecordingProvider()),
        index: openSourceIndex(':memory:'),
      }),
    ).rejects.toThrow('run drl sync first')
  })
})
