// Voyage rerank through MongoDB Atlas, the same endpoint and key as embeddings.
// Retries are ours (provider-request.ts), so the client's own retries are off.
import type { VoyageRerankSettings } from '@docs-rag-lab/settings'
import { VoyageAIClient } from 'voyageai'

import type { RateLimitProbe } from '../embeddings/provider.ts'
import { rateLimitHeadersOf, toRequestError } from '../embeddings/voyage.ts'
import { requireKey } from '../env.ts'
import type { RerankProvider, RerankResult } from './provider.ts'

interface RerankRequest {
  query: string
  documents: string[]
  model: string
  truncation: boolean
}

interface RerankResponse {
  data?: { index?: number; relevanceScore?: number }[]
  usage?: { totalTokens?: number }
}

/** The part of VoyageAIClient this provider uses; tests pass a fake. */
export interface VoyageRerankApi {
  rerank(request: RerankRequest): {
    withRawResponse(): Promise<{ data: RerankResponse; rawResponse: { headers: Headers } }>
  }
}

/** Scores in input order. The response is sorted by score, so each one is placed by its index. */
function scoresOf(response: RerankResponse, count: number): number[] {
  const data = response.data ?? []
  if (data.length !== count) {
    throw new Error(`Voyage returned ${String(data.length)} scores for ${String(count)} documents`)
  }
  const scores = new Array<number>(count).fill(Number.NaN)
  for (const { index, relevanceScore } of data) {
    if (index === undefined || relevanceScore === undefined || !(index in scores)) {
      throw new Error(`Voyage returned a score for no document: index ${String(index)}`)
    }
    if (!Number.isNaN(scores[index])) {
      throw new Error(`Voyage returned two scores for document ${String(index)}`)
    }
    scores[index] = relevanceScore
  }
  return scores
}

/**
 * A Voyage reranker. Without `api`, it builds the official client and reads
 * VOYAGE_API_KEY from the environment here, so settings never carry the key.
 */
export function createVoyageReranker(
  config: VoyageRerankSettings,
  api: VoyageRerankApi = new VoyageAIClient({
    apiKey: requireKey('VOYAGE_API_KEY'),
    environment: config.endpoint,
    maxRetries: 0,
    timeoutInSeconds: 120,
  }),
): RerankProvider {
  const request = async (query: string, documents: readonly string[]) => {
    try {
      // Truncation off: a score should come from the whole text, or fail.
      return await api
        .rerank({ query, documents: [...documents], model: config.model, truncation: false })
        .withRawResponse()
    } catch (error) {
      throw toRequestError(error)
    }
  }

  return {
    id: `voyage:${config.model}`,
    model: config.model,

    async rerank(query, documents): Promise<RerankResult> {
      if (documents.length === 0) return { scores: [], tokens: 0 }
      const { data } = await request(query, documents)
      const tokens = data.usage?.totalTokens
      if (tokens === undefined) throw new Error('Voyage response has no usage.totalTokens')
      return { scores: scoresOf(data, documents.length), tokens }
    },

    async probeRateLimits(): Promise<RateLimitProbe> {
      const { data, rawResponse } = await request('ok', ['ok'])
      return {
        headers: rateLimitHeadersOf(rawResponse.headers),
        tokens: data.usage?.totalTokens ?? 0,
      }
    },
  }
}
