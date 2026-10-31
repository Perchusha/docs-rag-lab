import { VoyageAIError } from 'voyageai'
import { describe, expect, it } from 'vitest'

import type { VoyageEmbeddingsConfig } from '../config.ts'
import { EmbeddingRequestError } from './provider.ts'
import { createVoyageProvider, type VoyageEmbedApi } from './voyage.ts'

const config: VoyageEmbeddingsConfig = {
  provider: 'voyage',
  endpoint: 'https://ai.example.com/v1',
  model: 'voyage-test',
  dimensions: 3,
  batch: { maxInputs: 10, maxTokens: 1000 },
  rateLimit: { rpm: 3, tpm: 10_000 },
}

type Response = Awaited<ReturnType<ReturnType<VoyageEmbedApi['embed']>['withRawResponse']>>

function fakeApi(respond: (request: Parameters<VoyageEmbedApi['embed']>[0]) => Promise<Response>) {
  const requests: Parameters<VoyageEmbedApi['embed']>[0][] = []
  const api: VoyageEmbedApi = {
    embed: (request) => {
      requests.push(request)
      return { withRawResponse: () => respond(request) }
    },
  }
  return { api, requests }
}

const ok = (
  embeddings: number[][],
  tokens: number,
  headers: Record<string, string> = {},
): Response => ({
  data: {
    data: embeddings.map((embedding, index) => ({ embedding, index })),
    usage: { totalTokens: tokens },
  },
  rawResponse: { headers: new Headers(headers) },
})

describe('createVoyageProvider', () => {
  it('names the vector space and sends the model, input type and dimensions', async () => {
    const { api, requests } = fakeApi(() =>
      Promise.resolve(
        ok(
          [
            [1, 0, 0],
            [0, 1, 0],
          ],
          7,
        ),
      ),
    )
    const provider = createVoyageProvider(config, 'key', api)

    const result = await provider.embed(['a', 'b'], 'document')

    expect(provider.id).toBe('voyage:voyage-test:3')
    expect(requests).toEqual([
      { input: ['a', 'b'], model: 'voyage-test', inputType: 'document', outputDimension: 3 },
    ])
    expect(result).toEqual({
      vectors: [new Float32Array([1, 0, 0]), new Float32Array([0, 1, 0])],
      tokens: 7,
    })
  })

  it('orders vectors by their index', async () => {
    const { api } = fakeApi(() =>
      Promise.resolve({
        data: {
          data: [
            { embedding: [0, 1, 0], index: 1 },
            { embedding: [1, 0, 0], index: 0 },
          ],
          usage: { totalTokens: 2 },
        },
        rawResponse: { headers: new Headers() },
      }),
    )
    const result = await createVoyageProvider(config, 'key', api).embed(['a', 'b'], 'query')
    expect(result.vectors[0]).toEqual(new Float32Array([1, 0, 0]))
  })

  it('rejects a response with the wrong number or size of embeddings', async () => {
    const short = createVoyageProvider(
      config,
      'key',
      fakeApi(() => Promise.resolve(ok([[1, 0, 0]], 1))).api,
    )
    await expect(short.embed(['a', 'b'], 'document')).rejects.toThrow('1 embeddings for 2 inputs')

    const narrow = createVoyageProvider(
      config,
      'key',
      fakeApi(() => Promise.resolve(ok([[1, 0]], 1))).api,
    )
    await expect(narrow.embed(['a'], 'document')).rejects.toThrow('2 dimensions, expected 3')
  })

  it('turns API errors into retryable or final request errors, with Retry-After', async () => {
    const limited = fakeApi(() =>
      Promise.reject(
        new VoyageAIError({
          message: 'Too many requests',
          statusCode: 429,
          rawResponse: {
            headers: new Headers({ 'retry-after': '20' }),
            redirected: false,
            status: 429,
            statusText: 'Too Many Requests',
            type: 'basic',
            url: config.endpoint,
          },
        }),
      ),
    )
    const error = await createVoyageProvider(config, 'key', limited.api)
      .embed(['a'], 'document')
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(EmbeddingRequestError)
    expect(error).toMatchObject({ status: 429, retryAfterMs: 20_000, retryable: true })

    const unauthorized = fakeApi(() =>
      Promise.reject(new VoyageAIError({ message: 'Unauthorized', statusCode: 401 })),
    )
    const final = await createVoyageProvider(config, 'key', unauthorized.api)
      .embed(['a'], 'document')
      .catch((e: unknown) => e)
    expect(final).toMatchObject({ status: 401, retryable: false })
  })

  it('reports rate-limit headers from one tiny request', async () => {
    const { api, requests } = fakeApi(() =>
      Promise.resolve(
        ok([[1, 0, 0]], 1, {
          'x-ratelimit-limit-requests': '3',
          'X-RateLimit-Limit-Tokens': '10000',
          'x-api-warning': 'reduced rate limits of 3 RPM and 10K TPM',
          'content-type': 'application/json',
        }),
      ),
    )
    const probe = await createVoyageProvider(config, 'key', api).probeRateLimits?.()

    expect(requests[0]?.input).toEqual(['ok'])
    expect(probe).toEqual({
      headers: {
        'x-api-warning': 'reduced rate limits of 3 RPM and 10K TPM',
        'x-ratelimit-limit-requests': '3',
        'x-ratelimit-limit-tokens': '10000',
      },
      tokens: 1,
    })
  })

  it('reports no headers when the API sends none', async () => {
    const { api } = fakeApi(() => Promise.resolve(ok([[1, 0, 0]], 1)))
    expect(await createVoyageProvider(config, 'key', api).probeRateLimits?.()).toEqual({
      headers: {},
      tokens: 1,
    })
  })
})
