import { openEmbeddingCache, openSourceIndex } from '@docs-rag-lab/db'
import { describe, expect, it } from 'vitest'

import { vectorSearch } from './retrieve.ts'
import { fakeVector, RecordingProvider } from './test-helpers.ts'
import { UsageMeter } from './usage.ts'

function seeded(provider: RecordingProvider) {
  const index = openSourceIndex(':memory:')
  const cache = openEmbeddingCache(':memory:')
  const chunk = (id: string) => ({
    id,
    ordinal: 0,
    headingPath: [id],
    anchor: id,
    blockTypes: ['prose'],
    text: `text ${id}`,
    metadata: {},
    tokenCount: 2,
    textHash: id,
    vector: fakeVector(`text ${id}`, provider.dimensions),
  })
  index.applyChanges({
    documents: [
      {
        path: 'a.md',
        url: 'https://x.dev/a',
        title: 'A',
        docType: 'handbook',
        contentHash: 'h',
        lastChangedSha: 's',
        chunks: [chunk('one'), chunk('two')],
      },
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
    },
  })
  return { index, cache }
}

describe('vectorSearch', () => {
  it('embeds the question as a query, through the cache, and returns the nearest chunks', async () => {
    const provider = new RecordingProvider()
    const { index, cache } = seeded(provider)
    const meter = new UsageMeter()

    const hits = await vectorSearch({
      question: 'text two',
      provider,
      index,
      cache,
      topK: 1,
      meter,
    })
    await vectorSearch({ question: 'text two', provider, index, cache, topK: 1, meter })

    expect(hits.map((hit) => hit.chunkId)).toEqual(['two'])
    expect(provider.calls).toEqual([{ texts: ['text two'], inputType: 'query' }])
  })

  it('refuses an index built with another embedding model', async () => {
    const { index, cache } = seeded(new RecordingProvider({ dimensions: 8 }))
    await expect(
      vectorSearch({
        question: 'q',
        provider: new RecordingProvider({ dimensions: 4 }),
        index,
        cache,
        topK: 1,
        meter: new UsageMeter(),
      }),
    ).rejects.toThrow('built with fake:hash:8')
  })

  it('refuses an empty index', async () => {
    await expect(
      vectorSearch({
        question: 'q',
        provider: new RecordingProvider(),
        index: openSourceIndex(':memory:'),
        cache: openEmbeddingCache(':memory:'),
        topK: 1,
        meter: new UsageMeter(),
      }),
    ).rejects.toThrow('run drl sync first')
  })
})
