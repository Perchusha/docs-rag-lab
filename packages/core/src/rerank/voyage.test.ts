import type { VoyageRerankSettings } from '@docs-rag-lab/settings'
import { VoyageAIError } from 'voyageai'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MissingKeyError } from '../env.ts'
import { ProviderRequestError } from '../provider-request.ts'
import { createVoyageReranker, type VoyageRerankApi } from './voyage.ts'

const config: VoyageRerankSettings = {
  provider: 'voyage',
  endpoint: 'https://ai.example.com/v1',
  model: 'rerank-test',
  depth: 20,
  batch: { maxTokens: 1000 },
  rateLimit: { rpm: 3, tpm: 10_000 },
}

type Response = Awaited<ReturnType<ReturnType<VoyageRerankApi['rerank']>['withRawResponse']>>
interface Item {
  index?: number
  relevanceScore?: number
}

function fakeApi(respond: () => Promise<Response>) {
  const requests: Parameters<VoyageRerankApi['rerank']>[0][] = []
  const api: VoyageRerankApi = {
    rerank: (request) => {
      requests.push(request)
      return { withRawResponse: respond }
    },
  }
  return { api, requests }
}

const ok = (data: Item[], tokens?: number, headers: Record<string, string> = {}): Response => ({
  data: { data, ...(tokens === undefined ? {} : { usage: { totalTokens: tokens } }) },
  rawResponse: { headers: new Headers(headers) },
})

describe('createVoyageReranker', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('reads VOYAGE_API_KEY itself when it builds the client, so settings never carry it', () => {
    vi.stubEnv('VOYAGE_API_KEY', undefined)
    expect(() => createVoyageReranker(config)).toThrow(MissingKeyError)

    vi.stubEnv('VOYAGE_API_KEY', 'pa-test')
    expect(createVoyageReranker(config).id).toBe('voyage:rerank-test')
  })

  it('sends the model with truncation off, and puts scores back in input order', async () => {
    const { api, requests } = fakeApi(() =>
      Promise.resolve(
        ok(
          [
            { index: 1, relevanceScore: 0.9 },
            { index: 2, relevanceScore: 0.5 },
            { index: 0, relevanceScore: 0.1 },
          ],
          42,
        ),
      ),
    )
    const result = await createVoyageReranker(config, api).rerank('q', ['a', 'b', 'c'])
    expect(requests).toEqual([
      { query: 'q', documents: ['a', 'b', 'c'], model: 'rerank-test', truncation: false },
    ])
    expect(result).toEqual({ scores: [0.1, 0.9, 0.5], tokens: 42 })
  })

  it('makes no request for no documents', async () => {
    const { api, requests } = fakeApi(() => Promise.reject(new Error('no call expected')))
    expect(await createVoyageReranker(config, api).rerank('q', [])).toEqual({
      scores: [],
      tokens: 0,
    })
    expect(requests).toEqual([])
  })

  it.each<[string, Item[]]>([
    ['too few scores', [{ index: 0, relevanceScore: 0.5 }]],
    [
      'an index beyond the documents',
      [
        { index: 0, relevanceScore: 0.5 },
        { index: 2, relevanceScore: 0.5 },
      ],
    ],
    [
      'a document scored twice',
      [
        { index: 0, relevanceScore: 0.5 },
        { index: 0, relevanceScore: 0.4 },
      ],
    ],
    ['a missing score', [{ index: 0 }, { index: 1, relevanceScore: 0.4 }]],
  ])('refuses a response with %s, so each document is scored exactly once', async (_, data) => {
    const { api } = fakeApi(() => Promise.resolve(ok(data, 1)))
    await expect(createVoyageReranker(config, api).rerank('q', ['a', 'b'])).rejects.toThrow(
      /Voyage returned/,
    )
  })

  it('refuses a response with no usage, since the meter could not count it', async () => {
    const { api } = fakeApi(() => Promise.resolve(ok([{ index: 0, relevanceScore: 0.5 }])))
    await expect(createVoyageReranker(config, api).rerank('q', ['a'])).rejects.toThrow(
      /usage\.totalTokens/,
    )
  })

  it('turns an API failure into a request error that says it can be retried', async () => {
    const { api } = fakeApi(() =>
      Promise.reject(
        new VoyageAIError({
          message: 'busy',
          statusCode: 429,
          rawResponse: {
            headers: new Headers({ 'retry-after': '2' }),
            redirected: false,
            status: 429,
            statusText: 'Too Many Requests',
            type: 'basic',
            url: 'https://ai.example.com/v1/rerank',
          },
        }),
      ),
    )
    const error: unknown = await createVoyageReranker(config, api)
      .rerank('q', ['a'])
      .catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ProviderRequestError)
    expect(error).toMatchObject({ status: 429, retryAfterMs: 2_000, retryable: true })
  })

  it('reports the rate-limit headers of one tiny request', async () => {
    const { api, requests } = fakeApi(() =>
      Promise.resolve(
        ok([{ index: 0, relevanceScore: 0.5 }], 2, {
          'x-api-warning': 'free trial',
          'content-type': 'application/json',
        }),
      ),
    )
    const probe = await createVoyageReranker(config, api).probeRateLimits?.()
    expect(requests[0]?.documents).toEqual(['ok'])
    expect(probe).toEqual({ headers: { 'x-api-warning': 'free trial' }, tokens: 2 })
  })
})
