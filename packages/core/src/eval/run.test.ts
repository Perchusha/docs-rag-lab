import type { RetrievalTrace, Strategy } from '@docs-rag-lab/contracts'
import type { Manifest } from '@docs-rag-lab/db'
import { describe, expect, it } from 'vitest'

import { RETRIEVAL_VERSION } from '../retrieve.ts'
import { UsageMeter } from '../usage.ts'
import type { GoldenCheck } from './anchors.ts'
import { GoldenSetError, parseGoldenSet } from './golden.ts'
import {
  parseEvalTargets,
  runRetrievalEval,
  vectorsHash,
  type RetrievalEvalOptions,
} from './run.ts'

const questions = parseGoldenSet(
  [
    { id: 'ts-0002', question: 'Second?', answer: 'A.', primary: ['b.md'], tags: ['edge'] },
    {
      id: 'ts-0001',
      question: 'First?',
      answer: 'A.',
      primary: ['a.md'],
      acceptable: ['b.md'],
      tags: ['basic'],
    },
    { id: 'ts-0003', question: 'Gone?', answer: 'A.', primary: ['gone.md'], tags: ['basic'] },
    { id: 'ts-0004', question: 'Not covered?', answer: 'No.', tags: ['unanswerable'] },
  ]
    .map((row) => JSON.stringify(row))
    .join('\n'),
)

const check: GoldenCheck = {
  setVersion: 3,
  setChanged: false,
  docsSha: 'docs-sha',
  questions: 4,
  unanswerable: 1,
  anchors: 3,
  stale: ['ts-0003'],
  review: ['ts-0002'],
  findings: [],
  docsMovedFrom: undefined,
  lock: {
    setVersion: 3,
    setHash: 'set-hash',
    docsSha: 'docs-sha',
    anchors: {
      'a.md': [{ chunkId: 'chunk-a', textHash: 'h' }],
      'b.md': [{ chunkId: 'chunk-b', textHash: 'h' }],
    },
  },
}

const manifest: Manifest = {
  sourceId: 'demo',
  repo: 'https://x.dev/repo',
  branch: 'main',
  includePaths: [],
  commitSha: 'docs-sha',
  syncedAt: '2026-11-03T00:00:00.000Z',
  embedModel: 'fake:hash:2',
  embedDimensions: 2,
  contextModel: null,
  chunkerVersion: 5,
  parserVersion: 1,
}

/** Rankings per strategy and question, best first. */
const RANKINGS: Record<Strategy, Record<string, string[]>> = {
  vector: { 'First?': ['chunk-a', 'chunk-b'], 'Second?': ['chunk-a', 'chunk-b'] },
  hybrid: { 'First?': ['chunk-b', 'chunk-a'], 'Second?': ['chunk-b', 'chunk-a'] },
  rerank: { 'First?': ['chunk-a', 'chunk-b'], 'Second?': ['chunk-a', 'chunk-b'] },
}

function trace(strategy: Strategy, question: string, totalMs: number): RetrievalTrace {
  const ranking = RANKINGS[strategy][question] ?? []
  const chunk = (id: string) => ({
    docPath: `${id}.md`,
    title: id.toUpperCase(),
    headingPath: [],
    sectionPath: ['Section'],
    part: null,
    anchor: '',
    docType: 'handbook',
    tokenCount: 1,
  })
  return {
    fusion:
      strategy === 'vector'
        ? { method: 'none' }
        : {
            method: 'rrf',
            k: 60,
            ms: 0,
            ranked: ranking.map((chunkId, i) => ({ chunkId, rank: i + 1, score: 1, ranks: {} })),
          },
    lists: [
      {
        name: 'vector',
        scoring: 'cosine-distance',
        ms: 0,
        candidates: ranking.map((chunkId, i) => ({ chunkId, rank: i + 1, score: 0 })),
      },
    ],
    chunks: Object.fromEntries(ranking.map((id) => [id, chunk(id)])),
    context: ranking.slice(0, 1).map((chunkId, i) => ({
      rank: i + 1,
      chunkId,
      source: '',
      title: '',
      text: '',
    })),
    totalMs,
  } as unknown as RetrievalTrace
}

function harness(overrides: Partial<RetrievalEvalOptions> = {}, totalMs = 5) {
  const calls: string[] = []
  const meter = new UsageMeter()
  const options: RetrievalEvalOptions = {
    engine: {
      embedQueries: (request) => {
        calls.push(`embed ${request.questions.join(' ')}`)
        meter.recordEmbedding('fake', 7)
        return Promise.resolve(request.questions.map(() => Float32Array.from([1, 0])))
      },
      search: (request) => {
        calls.push(`search ${String(request.strategy)} ${request.question}`)
        const strategy = request.strategy ?? 'hybrid'
        const result = trace(strategy, request.question, totalMs)
        return Promise.resolve({ hits: [], trace: result })
      },
    },
    sourceId: 'demo',
    questions,
    check,
    strategies: ['vector', 'hybrid'],
    targets: [],
    manifest,
    retrieval: { strategy: 'hybrid', topK: 8, candidates: 50, rrfK: 60 },
    index: { chunksHash: () => 'chunks', vectorsHash: () => 'corpus', schemaVersion: () => 3 },
    meter,
    run: { name: null, createdAt: 'now', repoSha: 'repo-sha', repoDirty: false },
    ...overrides,
  }
  return { options, calls }
}

describe('runRetrievalEval', () => {
  it('embeds the scored questions once, together and in ID order, before any search', async () => {
    const { options, calls } = harness()

    await runRetrievalEval(options)

    expect(calls[0]).toBe('embed First? Second?')
    expect(calls.filter((call) => call.startsWith('embed'))).toHaveLength(1)
    expect(calls.slice(1)).toEqual([
      'search vector First?',
      'search vector Second?',
      'search hybrid First?',
      'search hybrid Second?',
    ])
  })

  it('scores only questions with anchors that are not stale, and lists the others', async () => {
    const { options } = harness()

    const { result } = await runRetrievalEval(options)

    expect(result).toMatchObject({
      scored: 2,
      stale: ['ts-0003'],
      review: ['ts-0002'],
      unanswerable: ['ts-0004'],
    })
    expect(result.strategies[0]?.questions.map(({ id }) => id)).toEqual(['ts-0001', 'ts-0002'])
  })

  it('scores each strategy on its own ranking, through the locked chunks', async () => {
    const { options } = harness()

    const { result } = await runRetrievalEval(options)

    const [vector, hybrid] = result.strategies
    expect(vector?.questions[0]).toMatchObject({
      id: 'ts-0001',
      primaryRank: 1,
      acceptableRank: 1,
      context: ['chunk-a'],
    })
    expect(hybrid?.questions[0]).toMatchObject({
      id: 'ts-0001',
      primaryRank: 2,
      acceptableRank: 1,
      context: ['chunk-b'],
    })
    expect(vector?.overall.primary.mrr).toBe(0.75)
  })

  it('compares two strategies and not one', async () => {
    const two = harness()
    const one = harness({ strategies: ['hybrid'] })

    const both = await runRetrievalEval(two.options)
    const single = await runRetrievalEval(one.options)

    expect(both.result.comparison).toMatchObject({ a: 'vector', b: 'hybrid' })
    expect(single.result.comparison).toBeNull()
    expect(one.calls.some((call) => call.includes('vector'))).toBe(false)
  })

  it('says whether hybrid reaches each target, with every strategy rank beside it', async () => {
    const { options } = harness({
      targets: [
        { questionId: 'ts-0001', anchor: 'a.md', rank: 1 },
        { questionId: 'ts-0001', anchor: 'a.md', rank: 2 },
        { questionId: 'ts-0001', anchor: 'b.md', rank: 1 },
      ],
    })

    const { result } = await runRetrievalEval(options)

    expect(result.targets).toEqual([
      {
        questionId: 'ts-0001',
        anchor: 'a.md',
        target: 1,
        ranks: { vector: 1, hybrid: 2 },
        met: false,
      },
      {
        questionId: 'ts-0001',
        anchor: 'a.md',
        target: 2,
        ranks: { vector: 1, hybrid: 2 },
        met: true,
      },
      {
        questionId: 'ts-0001',
        anchor: 'b.md',
        target: 1,
        ranks: { vector: 2, hybrid: 1 },
        met: true,
      },
    ])
  })

  it('says nothing about a target when the default strategy did not run', async () => {
    const { options } = harness({
      strategies: ['vector'],
      targets: [{ questionId: 'ts-0001', anchor: 'a.md', rank: 8 }],
    })

    const { result } = await runRetrievalEval(options)

    expect(result.targets[0]).toMatchObject({ ranks: { vector: 1 }, met: null })
  })

  it('judges a target by the default strategy in the settings, not by a fixed one', async () => {
    const { options } = harness({
      retrieval: { strategy: 'vector', topK: 8, candidates: 50, rrfK: 60 },
      targets: [{ questionId: 'ts-0001', anchor: 'a.md', rank: 1 }],
    })

    const { result } = await runRetrievalEval(options)

    expect(result.targets[0]).toMatchObject({ ranks: { vector: 1, hybrid: 2 }, met: true })
  })

  it('records a retrieval setting it has never heard of, so it cannot go unnoticed', async () => {
    const retrieval = { strategy: 'hybrid', topK: 8, candidates: 50, rrfK: 60, newSetting: 'on' }
    const { options } = harness({ retrieval: retrieval as RetrievalEvalOptions['retrieval'] })

    const report = await runRetrievalEval(options)

    expect(report.identity.retrieval).toEqual({
      topK: 8,
      candidates: 50,
      rrfK: 60,
      newSetting: 'on',
    })
  })

  it('refuses a top K that is not what recall@8 measures', async () => {
    const { options } = harness({
      retrieval: { strategy: 'hybrid', topK: 5, candidates: 50, rrfK: 60 },
    })

    await expect(runRetrievalEval(options)).rejects.toThrow('the settings send 5 chunks')
  })

  it('refuses a context that is not the top of the ranking', async () => {
    const { options } = harness()
    const { search } = options.engine
    options.engine.search = async (request, meter) => {
      const { hits, trace: found } = await search(request, meter)
      const context = [{ ...found.context[0], chunkId: 'chunk-z' }] as RetrievalTrace['context']
      return { hits, trace: { ...found, context } }
    }

    await expect(runRetrievalEval(options)).rejects.toThrow('the ranking and the context disagree')
  })

  it('stops both strategies at the same depth, so fusion gets no deeper ranks to count', async () => {
    const { options } = harness({
      retrieval: { strategy: 'hybrid', topK: 8, candidates: 1, rrfK: 60 },
    })

    const { result } = await runRetrievalEval(options)

    // Under hybrid, First? ranks chunk-a second, which is past a depth of 1.
    expect(result.strategies[1]?.questions[0]).toMatchObject({ primaryRank: null })
  })

  it('embeds a question as a search will trim it', async () => {
    const padded = parseGoldenSet(
      JSON.stringify({
        id: 'ts-0001',
        question: ' First? ',
        answer: 'A.',
        primary: ['a.md'],
        tags: ['basic'],
      }),
    )
    const { options, calls } = harness({ questions: padded, check: { ...check, stale: [] } })

    await runRetrievalEval(options)

    expect(calls[0]).toBe('embed First?')
  })

  it('records what was measured, without the strategy, which is per result', async () => {
    const { options } = harness()

    const report = await runRetrievalEval(options)

    expect(report.identity).toEqual({
      sourceId: 'demo',
      docs: { repo: 'https://x.dev/repo', branch: 'main', sha: 'docs-sha' },
      chunkerVersion: 5,
      parserVersion: 1,
      indexSchema: 3,
      embedModel: 'fake:hash:2',
      contextModel: null,
      chunksHash: 'chunks',
      goldenSet: { version: 3, hash: 'set-hash' },
      retrievalVersion: RETRIEVAL_VERSION,
      retrieval: { topK: 8, candidates: 50, rrfK: 60 },
    })
    expect(report.vectors.corpusHash).toBe('corpus')
    expect(report.vectors.queryHash).toBe(
      vectorsHash([Float32Array.from([1, 0]), Float32Array.from([1, 0])]),
    )
  })

  it('names the reranker only in a report that measured it, so earlier reports stay comparable', async () => {
    const rerank = { model: 'fake-rerank', depth: 20 }
    const without = await runRetrievalEval(harness({ rerank }).options)
    expect(without.identity).not.toHaveProperty('rerank')

    const report = await runRetrievalEval(
      harness({ rerank, strategies: ['vector', 'hybrid', 'rerank'] }).options,
    )
    expect(report.identity.rerank).toEqual(rerank)
    expect(report.result.strategies.map(({ strategy }) => strategy)).toEqual([
      'vector',
      'hybrid',
      'rerank',
    ])
    // The comparison stays the first two, as in every earlier report.
    expect(report.result.comparison).toEqual(without.result.comparison)
  })

  it('says how many 429s the reranks survived, outside the result, and nothing without rerank', async () => {
    const { options } = harness({ strategies: ['vector', 'rerank'] })
    const { search } = options.engine
    options.engine = {
      ...options.engine,
      search: async (request, meter) => {
        const found = await search(request, meter)
        return request.strategy !== 'rerank'
          ? found
          : {
              ...found,
              trace: {
                ...found.trace,
                rerank: {
                  provider: 'fake:rerank',
                  depth: 20,
                  from: 'cache',
                  rateLimitRetries: request.question === 'First?' ? 1 : 0,
                  ms: 0,
                  ranked: [],
                },
              },
            }
      },
    }
    const report = await runRetrievalEval(options)
    expect(report.run.rerank).toEqual({ calls: 2, rateLimitRetries: 1 })

    const without = await runRetrievalEval(harness().options)
    expect(without.run).not.toHaveProperty('rerank')
  })

  it('keeps timings and usage out of the result, so two runs compare byte for byte', async () => {
    const fast = await runRetrievalEval(harness({}, 5).options)
    const slow = await runRetrievalEval(harness({}, 500).options)

    expect(JSON.stringify(fast.result)).toBe(JSON.stringify(slow.result))
    expect(fast.run.timings.hybrid).toEqual({ meanMs: 5, maxMs: 5 })
    expect(slow.run.timings.hybrid).toEqual({ meanMs: 500, maxMs: 500 })
    expect(fast.run.usage).toEqual({ embeddingTokens: 7, embeddingRequests: 1 })
  })

  it('names every chunk in a context, sorted', async () => {
    const { options } = harness()

    const { result } = await runRetrievalEval(options)

    expect(Object.keys(result.chunks)).toEqual(['chunk-a', 'chunk-b'])
    expect(result.chunks['chunk-a']).toEqual({
      label: 'CHUNK-A > Section',
      docPath: 'chunk-a.md',
    })
  })
})

describe('vectorsHash', () => {
  it('depends on the numbers and their order', () => {
    const a = Float32Array.from([1, 2])
    const b = Float32Array.from([3, 4])

    expect(vectorsHash([a, b])).toBe(vectorsHash([Float32Array.from([1, 2]), b]))
    expect(vectorsHash([a, b])).not.toBe(vectorsHash([b, a]))
    expect(vectorsHash([a])).not.toBe(vectorsHash([Float32Array.from([1, 2.0000002])]))
  })

  it('reads a view at its own offset, not its whole buffer', () => {
    const shared = Float32Array.from([9, 1, 2, 9])

    expect(vectorsHash([shared.subarray(1, 3)])).toBe(vectorsHash([Float32Array.from([1, 2])]))
  })
})

describe('parseEvalTargets', () => {
  it('reads targets that name a question and one of its anchors', () => {
    const text = JSON.stringify([
      { questionId: 'ts-0001', anchor: 'a.md', rank: 1 },
      { questionId: 'ts-0001', anchor: 'b.md', rank: 8 },
    ])

    expect(parseEvalTargets(text, questions)).toEqual([
      { questionId: 'ts-0001', anchor: 'a.md', rank: 1 },
      { questionId: 'ts-0001', anchor: 'b.md', rank: 8 },
    ])
  })

  it.each([
    ['text that is not JSON', '{', 'not valid JSON'],
    ['something other than a list', '{}', 'must be an array'],
    ['no anchor', [{ questionId: 'ts-0001', rank: 1 }], 'needs questionId and anchor'],
    ['no question', [{ anchor: 'a.md', rank: 1 }], 'needs questionId and anchor'],
    ['a rank of 0', [{ questionId: 'ts-0001', anchor: 'a.md', rank: 0 }], 'rank must be'],
    ['a fractional rank', [{ questionId: 'ts-0001', anchor: 'a.md', rank: 1.5 }], 'rank must be'],
    ['an unknown question', [{ questionId: 'ts-9999', anchor: 'a.md', rank: 1 }], 'no question'],
    [
      "another question's anchor",
      [{ questionId: 'ts-0002', anchor: 'a.md', rank: 1 }],
      'ts-0002 has no anchor a.md',
    ],
  ])('refuses %s', (_name, value, message) => {
    const text = typeof value === 'string' ? value : JSON.stringify(value)

    expect(() => parseEvalTargets(text, questions)).toThrow(GoldenSetError)
    expect(() => parseEvalTargets(text, questions)).toThrow(message)
  })
})
