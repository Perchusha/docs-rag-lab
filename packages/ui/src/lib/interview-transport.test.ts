import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchInterviewTransport } from './interview-transport.ts'

const endpoints = {
  overview: '/api/interview/overview',
  deck: '/api/interview/deck',
  review: '/api/interview/review',
  flag: '/api/interview/flag',
  mock: '/api/interview/mock',
  mockAnswer: '/api/interview/mock/answer',
  mockSummary: '/api/interview/mock/summary',
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchInterviewTransport (ADR-0018)', () => {
  it('asks the routes with the chosen sources and the topic', async () => {
    const calls: [string, RequestInit | undefined][] = []
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      calls.push([url, init])
      return Promise.resolve(Response.json({ ok: true }))
    })
    const transport = fetchInterviewTransport(endpoints)

    await transport.overview(['typescript', 'react'])
    await transport.deck(['react'], { source: 'react', id: 'reference/hooks' })
    await transport.review({ questionId: 'q1', rating: 'good' })
    await transport.flag({ questionId: 'q2', reason: 'Wrong.' })
    await transport.mockStart(['react'])
    await transport.mockAnswer({
      sessionId: 's1',
      questionId: 'q1',
      step: 'question',
      answer: 'A.',
    })
    await transport.mockSummary('s1')

    expect(calls.map(([url]) => url)).toEqual([
      '/api/interview/overview?sources=typescript%2Creact',
      '/api/interview/deck?sources=react&topic=react%3Areference%2Fhooks',
      '/api/interview/review',
      '/api/interview/flag',
      '/api/interview/mock',
      '/api/interview/mock/answer',
      '/api/interview/mock/summary?session=s1',
    ])
    expect(calls[4]?.[1]).toMatchObject({ method: 'POST', body: '{"sources":["react"]}' })
    expect(calls[2]?.[1]).toMatchObject({
      method: 'POST',
      body: '{"questionId":"q1","rating":"good"}',
    })
    expect(calls[3]?.[1]).toMatchObject({
      method: 'POST',
      body: '{"questionId":"q2","reason":"Wrong."}',
    })
  })

  it('throws the error a route sends', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(Response.json({ error: 'choose at least one technology' }, { status: 400 })),
    )

    await expect(fetchInterviewTransport(endpoints).overview([])).rejects.toThrow(
      'choose at least one technology',
    )
  })
})
