// Vector-only retrieval for M1 (hybrid search and the trace object arrive in
// M2). The query embedding goes through the cache too.
import type { EmbeddingCache, SearchHit, SourceIndex } from '@docs-rag-lab/db'

import { embedWithCache } from './embeddings/cached.ts'
import type { EmbeddingProvider } from './embeddings/provider.ts'
import type { RateLimiter } from './embeddings/rate-limit.ts'
import type { UsageMeter } from './usage.ts'

export interface VectorSearchOptions {
  question: string
  provider: EmbeddingProvider
  index: SourceIndex
  cache: EmbeddingCache
  topK: number
  meter: UsageMeter
  limiter?: RateLimiter | undefined
}

export async function vectorSearch(options: VectorSearchOptions): Promise<SearchHit[]> {
  const { index, provider } = options
  const manifest = index.getManifest()
  if (manifest === undefined) throw new Error('the index is empty: run drl sync first')
  if (manifest.embedModel !== provider.id) {
    throw new Error(
      `the index was built with ${manifest.embedModel}, but the config uses ${provider.id}: run drl sync again`,
    )
  }
  const [vector] = await embedWithCache([options.question], {
    provider,
    cache: options.cache,
    inputType: 'query',
    meter: options.meter,
    limiter: options.limiter,
  })
  if (vector === undefined) throw new Error('no query vector')
  return index.searchVectors(vector, options.topK)
}
