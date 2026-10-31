// Voyage AI through MongoDB Atlas (SPEC section 5). The official client calls
// api.voyageai.com unless `environment` names the Atlas endpoint. Retries are
// ours (cached.ts), so the client's own retries are off.
import { VoyageAIClient, VoyageAIError, VoyageAITimeoutError } from 'voyageai'

import type { VoyageEmbeddingsConfig } from '../config.ts'
import {
  EmbeddingRequestError,
  type EmbeddingProvider,
  type EmbedResult,
  type InputType,
  type RateLimitProbe,
} from './provider.ts'

interface EmbedRequest {
  input: string[]
  model: string
  inputType: InputType
  outputDimension: number
}

interface EmbedResponse {
  data?: { embedding?: number[]; index?: number }[]
  usage?: { totalTokens?: number }
}

/** The part of VoyageAIClient this provider uses; tests pass a fake. */
export interface VoyageEmbedApi {
  embed(request: EmbedRequest): {
    withRawResponse(): Promise<{ data: EmbedResponse; rawResponse: { headers: Headers } }>
  }
}

function retryAfterMs(headers: Headers | undefined): number | undefined {
  const value = headers?.get('retry-after')
  if (value === null || value === undefined) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const date = Date.parse(value)
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now())
}

function toRequestError(error: unknown): unknown {
  if (error instanceof VoyageAITimeoutError) {
    return new EmbeddingRequestError(`Voyage request timed out: ${error.message}`, { cause: error })
  }
  if (error instanceof VoyageAIError) {
    const options: { status?: number; retryAfterMs?: number; cause: unknown } = { cause: error }
    if (error.statusCode !== undefined) options.status = error.statusCode
    const retryAfter = retryAfterMs(error.rawResponse?.headers)
    if (retryAfter !== undefined) options.retryAfterMs = retryAfter
    return new EmbeddingRequestError(
      `Voyage request failed${error.statusCode === undefined ? '' : ` (${String(error.statusCode)})`}: ${error.message}`,
      options,
    )
  }
  if (error instanceof TypeError) {
    // fetch reports network failures as TypeError.
    return new EmbeddingRequestError(`Voyage request failed: ${error.message}`, { cause: error })
  }
  return error
}

function vectorsOf(response: EmbedResponse, count: number, dimensions: number): Float32Array[] {
  const data = response.data ?? []
  if (data.length !== count) {
    throw new Error(`Voyage returned ${String(data.length)} embeddings for ${String(count)} inputs`)
  }
  const vectors: Float32Array[] = new Array<Float32Array>(count)
  data.forEach((item, position) => {
    const index = item.index ?? position
    const embedding = item.embedding
    if (embedding?.length !== dimensions) {
      throw new Error(
        `Voyage returned an embedding with ${String(embedding?.length)} dimensions, expected ${String(dimensions)}`,
      )
    }
    vectors[index] = Float32Array.from(embedding)
  })
  return vectors
}

const RATE_LIMIT_HEADER = /ratelimit|rate-limit|retry-after/i

export function createVoyageProvider(
  config: VoyageEmbeddingsConfig,
  apiKey: string,
  api: VoyageEmbedApi = new VoyageAIClient({
    apiKey,
    environment: config.endpoint,
    maxRetries: 0,
    timeoutInSeconds: 120,
  }),
): EmbeddingProvider {
  const request = async (texts: readonly string[], inputType: InputType) => {
    try {
      return await api
        .embed({
          input: [...texts],
          model: config.model,
          inputType,
          outputDimension: config.dimensions,
        })
        .withRawResponse()
    } catch (error) {
      throw toRequestError(error)
    }
  }

  return {
    id: `voyage:${config.model}:${String(config.dimensions)}`,
    model: config.model,
    dimensions: config.dimensions,
    limits: config.batch,

    async embed(texts, inputType): Promise<EmbedResult> {
      if (texts.length === 0) return { vectors: [], tokens: 0 }
      const { data } = await request(texts, inputType)
      const tokens = data.usage?.totalTokens
      if (tokens === undefined) throw new Error('Voyage response has no usage.totalTokens')
      return { vectors: vectorsOf(data, texts.length, config.dimensions), tokens }
    },

    async probeRateLimits(): Promise<RateLimitProbe> {
      const { data, rawResponse } = await request(['ok'], 'query')
      const headers: Record<string, string> = {}
      rawResponse.headers.forEach((value, name) => {
        if (RATE_LIMIT_HEADER.test(name)) headers[name.toLowerCase()] = value
      })
      return { headers, tokens: data.usage?.totalTokens ?? 0 }
    },
  }
}
