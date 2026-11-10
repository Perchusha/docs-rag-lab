import type { Strategy } from '@docs-rag-lab/contracts'
import {
  openEmbeddingCache,
  openRerankCache,
  openSourceIndex,
  type ChunkWrite,
} from '@docs-rag-lab/db'
import type { RetrievalSettings } from '@docs-rag-lab/settings'
import { describe, expect, expectTypeOf, it } from 'vitest'

import { RateLimiter } from './embeddings/rate-limit.ts'
import { rankingOf } from './eval/metrics.ts'
import type { RerankProvider } from './rerank/provider.ts'
import { retrieve, type RerankStep, type RetrieveOptions } from './retrieve.ts'
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

function seeded(provider: RecordingProvider, contexts: Record<string, string> = {}) {
  const index = openSourceIndex(':memory:')
  const cache = openEmbeddingCache(':memory:')
  const chunk = (id: string, text: string, vectorOf = text): ChunkWrite => ({
    id,
    ordinal: 0,
    headingPath: [id],
    anchor: id,
    blockTypes: ['prose'],
    text,
    context: contexts[id] ?? null,
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

/** A reranker that scores by a function of the document, and the calls it got. */
function rerankStep(score: (document: string) => number, depth = 3) {
  const calls: { query: string; documents: string[] }[] = []
  const provider: RerankProvider = {
    id: 'fake:rerank',
    model: 'fake-rerank',
    rerank: (query, documents) => {
      calls.push({ query, documents: [...documents] })
      return Promise.resolve({ scores: documents.map(score), tokens: 10 })
    },
  }
  const step: RerankStep = { provider, depth, cache: openRerankCache(':memory:') }
  return { step, calls }
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

  it("tells of a wait for the embedding's rate limit, and gives the wait up when stopped", async () => {
    const clock = {
      now: () => 0,
      sleep: (ms: number) => {
        told.push(-ms)
        return new Promise<void>(() => undefined)
      },
    }
    const told: number[] = []
    const limiter = new RateLimiter({ rpm: 1, tpm: 1_000_000 }, clock)
    await limiter.acquire(1)
    const controller = new AbortController()

    const searching = retrieve(
      options(new RecordingProvider(), {
        limiter,
        onWait: (ms) => {
          told.push(ms)
          controller.abort(new Error('stopped'))
        },
        signal: controller.signal,
      }),
    )

    await expect(searching).rejects.toThrow('stopped')
    // Stopped while being told, so it never sleeps.
    expect(told).toEqual([60_250])
  })

  describe('rerank', () => {
    const rerankOptions = (
      provider: RecordingProvider,
      step: RerankStep,
      overrides: Partial<RetrievalSettings> = {},
    ) =>
      options(provider, { settings: settings({ strategy: 'rerank', ...overrides }), rerank: step })

    it('scores the fused top in one call, in fused order, and the best go to the answer', async () => {
      const provider = new RecordingProvider()
      const fused = await retrieve(options(provider))
      const fusedIds = rankingOf(fused.trace)
      const textOf = new Map(
        fusedIds.map((id) => [id, fused.trace.context.find((c) => c.chunkId === id)?.text ?? '']),
      )
      // The second fused chunk scores best, then the first, then the third.
      const { step, calls } = rerankStep((document) =>
        document === textOf.get(fusedIds[0] ?? '')
          ? 0.5
          : document === textOf.get(fusedIds[1] ?? '')
            ? 0.9
            : 0.1,
      )
      const { hits, trace } = await retrieve(rerankOptions(provider, step))

      expect(calls).toHaveLength(1)
      expect(calls[0]?.query).toBe(QUESTION)
      expect(calls[0]?.documents).toHaveLength(3)
      expect(calls[0]?.documents.slice(0, 2)).toEqual([
        textOf.get(fusedIds[0] ?? ''),
        textOf.get(fusedIds[1] ?? ''),
      ])

      expect(trace.strategy).toBe('rerank')
      expect(trace.fusion).toMatchObject({ method: 'rrf' })
      expect(
        trace.fusion.method === 'rrf' ? trace.fusion.ranked.map(({ chunkId }) => chunkId) : [],
      ).toEqual(fusedIds)
      expect(trace.rerank).toMatchObject({ provider: 'fake:rerank', depth: 3, from: 'api' })
      expect(
        trace.rerank?.ranked.map(({ chunkId, rank, fusedRank }) => [chunkId, rank, fusedRank]),
      ).toEqual([
        [fusedIds[1], 1, 2],
        [fusedIds[0], 2, 1],
        [fusedIds[2], 3, 3],
      ])
      expect(hits.map((hit) => hit.chunkId)).toEqual([fusedIds[1], fusedIds[0]])
      expect(trace.context.map((chunk) => chunk.chunkId)).toEqual([fusedIds[1], fusedIds[0]])
    })

    it('keeps the fused order for equal scores', async () => {
      const provider = new RecordingProvider()
      const fusedIds = rankingOf((await retrieve(options(provider))).trace)
      const { step } = rerankStep(() => 0.5)
      const { trace } = await retrieve(rerankOptions(provider, step))
      expect(trace.rerank?.ranked.map(({ chunkId }) => chunkId)).toEqual(fusedIds.slice(0, 3))
    })

    it('keeps the fused order below the depth, so a report still ranks as deep', async () => {
      const provider = new RecordingProvider()
      const fusedIds = rankingOf((await retrieve(options(provider))).trace)
      expect(fusedIds.length).toBeGreaterThan(2)
      const { step } = rerankStep((document) => document.length, 2)
      const { hits, trace } = await retrieve(rerankOptions(provider, step, { topK: 4 }))

      const reranked = trace.rerank?.ranked.map(({ chunkId }) => chunkId) ?? []
      expect([...reranked].sort()).toEqual(fusedIds.slice(0, 2).sort())
      expect(rankingOf(trace)).toEqual([...reranked, ...fusedIds.slice(2)])
      expect(hits.map((hit) => hit.chunkId)).toEqual(rankingOf(trace).slice(0, 4))
    })

    it('reruns from the cache, with no call and the same order', async () => {
      const provider = new RecordingProvider()
      const { step, calls } = rerankStep((document) => document.length)
      const first = await retrieve(rerankOptions(provider, step))
      const second = await retrieve(rerankOptions(provider, step))
      expect(calls).toHaveLength(1)
      expect(second.trace.rerank?.from).toBe('cache')
      expect(second.trace.rerank?.ranked).toEqual(first.trace.rerank?.ranked)
    })

    it('sends the text alone from a plain index, as row 4 asks', async () => {
      const provider = new RecordingProvider()
      const { step, calls } = rerankStep(() => 0.5)
      const { hits } = await retrieve(rerankOptions(provider, step, { topK: 3 }))
      expect(calls[0]?.documents).toEqual(hits.map((hit) => hit.text))
    })

    it('sends the context and the text from a contextual index, and still answers from the text', async () => {
      const provider = new RecordingProvider()
      const contexts = { near: 'CONTEXT of near.', code: 'CONTEXT of code.' }
      const { step, calls } = rerankStep(() => 0.5)
      const { hits, trace } = await retrieve({
        ...options(provider, {
          settings: settings({ strategy: 'rerank', topK: 3 }),
          rerank: step,
        }),
        ...seeded(provider, contexts),
      })
      const hitOf = (id: string) => hits.find((hit) => hit.chunkId === id)
      const documents = calls[0]?.documents ?? []
      expect(documents).toContain(`CONTEXT of near.\n\n${hitOf('near')?.text ?? ''}`)
      expect(documents).toContain(`CONTEXT of code.\n\n${hitOf('code')?.text ?? ''}`)
      expect(hitOf('near')?.context).toBe('CONTEXT of near.')
      // What goes to the answer, and what the judge checks citations against, is the docs' text.
      expect(JSON.stringify(trace.context)).not.toContain('CONTEXT')
      expect(trace.context.map((chunk) => chunk.text)).toEqual(hits.map((hit) => hit.text))
    })

    it('refuses the strategy with no reranker', async () => {
      await expect(
        retrieve(options(new RecordingProvider(), { settings: settings({ strategy: 'rerank' }) })),
      ).rejects.toThrow('the rerank strategy needs a reranker')
    })

    it.each(['vector', 'hybrid'] as const)(
      '%s never calls the reranker, and its trace has no rerank',
      async (strategy) => {
        const provider = new RecordingProvider()
        const without = await retrieve(options(provider, { settings: settings({ strategy }) }))
        const { step, calls } = rerankStep(() => 0.5)
        const { hits, trace } = await retrieve(
          options(provider, { settings: settings({ strategy }), rerank: step }),
        )
        expect(calls).toEqual([])
        expect(trace).not.toHaveProperty('rerank')
        expect(hits.map((hit) => hit.chunkId)).toEqual(without.hits.map((hit) => hit.chunkId))
      },
    )
  })

  it('finds a chunk by a word only its context has: BM25 reads the context', async () => {
    const provider = new RecordingProvider()
    const question = 'zebrafinch?'
    const contexts = { filler1: 'This part is about zebrafinch declarations.' }
    const { trace } = await retrieve({
      ...options(provider, { question }),
      ...seeded(provider, contexts),
    })
    const keyword = trace.lists.find((list) => list.name === 'keyword')
    expect(keyword?.candidates.map((candidate) => candidate.chunkId)).toEqual(['filler1'])
    // And the plain index has no such word.
    const plain = await retrieve(options(provider, { question }))
    expect(plain.trace.lists.find((list) => list.name === 'keyword')?.candidates).toEqual([])
  })

  it('returns a versioned trace that survives JSON, with timings from the clock', async () => {
    const provider = new RecordingProvider()
    let tick = 0
    const { trace } = await retrieve(options(provider, { now: () => (tick += 5) }))

    expect(JSON.parse(JSON.stringify(trace))).toEqual(trace)
    expect(trace).toMatchObject({
      version: 5,
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
