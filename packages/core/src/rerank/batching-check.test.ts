import { estimateTokens } from '@docs-rag-lab/source-kit'
import { describe, expect, it } from 'vitest'

import { UsageMeter } from '../usage.ts'
import {
  batchForRerank,
  compositionsOf,
  planBatchingCheck,
  runBatchingCheck,
  type BatchingCheckOptions,
  type BatchingCheckQuestion,
} from './batching-check.ts'
import { estimateRerankTokens, type RerankProvider } from './provider.ts'

// About 14, 48, 25, 37 and 60 estimated tokens each, with the query.
const text = (letter: string, size: number): string => letter.repeat(size * 4)
const documents = [text('a', 10), text('b', 40), text('c', 20), text('d', 30), text('e', 50)]
const question: BatchingCheckQuestion = { id: 'ts-1', question: 'qqqq', documents }

/** A score that depends only on the document, or also on what `shift` says of the call. */
function fakeProvider(shift: (documents: readonly string[], call: number) => number = () => 0) {
  const calls: string[][] = []
  const provider: RerankProvider = {
    id: 'fake:rerank',
    model: 'fake-rerank',
    rerank: (_query, sent) => {
      calls.push([...sent])
      const extra = shift(sent, calls.length)
      return Promise.resolve({
        scores: sent.map((document) => 1 / document.length + extra),
        tokens: estimateRerankTokens(_query, sent),
      })
    },
  }
  return { provider, calls }
}

function options(provider: RerankProvider): BatchingCheckOptions {
  return { provider, meter: new UsageMeter(), maxTokens: 70 }
}

describe('estimateRerankTokens', () => {
  it('counts the query once per document, as Voyage bills it', () => {
    const [a, b] = [text('a', 10), text('b', 20)]
    const query = estimateTokens('qqqq')
    expect(estimateRerankTokens('qqqq', [a, b])).toBe(
      query + estimateTokens(a) + query + estimateTokens(b),
    )
  })
})

describe('batchForRerank', () => {
  it('splits in order under the limit, and covers every document once', () => {
    expect(batchForRerank('qqqq', documents, 70)).toEqual([[0, 1], [2, 3], [4]])
  })

  it('gives a document over the limit a request of its own', () => {
    expect(batchForRerank('qqqq', [text('a', 10), text('b', 100), text('c', 10)], 50)).toEqual([
      [0],
      [1],
      [2],
    ])
  })

  it('makes no request for no documents', () => {
    expect(batchForRerank('q', [], 50)).toEqual([])
  })
})

describe('compositionsOf', () => {
  it('holds the composition a run would use, and the shortest, middle and longest alone', () => {
    const byName = Object.fromEntries(
      compositionsOf('qqqq', documents, 70).map(({ name, calls }) => [name, calls]),
    )
    expect(byName).toEqual({
      repeat: [[0, 1, 2, 3, 4]],
      reversed: [[4, 3, 2, 1, 0]],
      halves: [
        [0, 1, 2],
        [3, 4],
      ],
      batched: batchForRerank('qqqq', documents, 70),
      alone: [[0], [3], [4]],
    })
  })
})

describe('planBatchingCheck', () => {
  it('counts the first call and every composition', () => {
    const plan = planBatchingCheck([question], 70)
    // first, repeat, reversed, 2 halves, 3 batched, 3 alone.
    expect(plan.calls).toBe(11)
    const whole = estimateRerankTokens('qqqq', documents)
    const alone = estimateRerankTokens('qqqq', [
      documents[0] ?? '',
      documents[3] ?? '',
      documents[4] ?? '',
    ])
    expect(plan.estimatedTokens).toBe(5 * whole + alone)
  })
})

describe('runBatchingCheck', () => {
  it('finds no difference when a score depends only on its pair, and compares every document', async () => {
    const { provider, calls } = fakeProvider()
    const check = await runBatchingCheck([question], options(provider))
    // 5 documents in repeat and reversed.
    expect(check.identicalSets).toEqual({ compared: 10, differing: 0, largestDifference: 0 })
    // 5 documents in halves and batched, then 3 alone.
    expect(check.differentSets).toEqual({ compared: 13, differing: 0, largestDifference: 0 })
    expect(calls).toHaveLength(planBatchingCheck([question], 70).calls)
    expect(check.questions[0]?.scores).toEqual(documents.map((document) => 1 / document.length))
  })

  it('puts scores back on the right document when the order is reversed', async () => {
    const { provider } = fakeProvider()
    const check = await runBatchingCheck([question], options(provider))
    const reversed = check.questions[0]?.compositions.find(({ name }) => name === 'reversed')
    expect(reversed).toMatchObject({ differing: 0, orderChanged: false })
  })

  it('counts the smallest difference as a different set, and says where and how much', async () => {
    const { provider } = fakeProvider((sent) => (sent.length === 3 ? 1e-12 : 0))
    const check = await runBatchingCheck([question], options(provider))
    expect(check.identicalSets.differing).toBe(0)
    expect(check.differentSets.differing).toBe(3)
    const halves = check.questions[0]?.compositions.find(({ name }) => name === 'halves')
    expect(halves?.differing).toBe(3)
    expect(halves?.largestDifference).toBeGreaterThan(0)
    expect(halves?.largestDifference).toBeLessThan(1e-11)
    const repeat = check.questions[0]?.compositions.find(({ name }) => name === 'repeat')
    expect(repeat?.differing).toBe(0)
  })

  it('shows jitter in the repeat, which tells it from an effect of the batch', async () => {
    const { provider } = fakeProvider((_sent, call) => (call === 2 ? 0.001 : 0))
    const check = await runBatchingCheck([question], options(provider))
    const repeat = check.questions[0]?.compositions.find(({ name }) => name === 'repeat')
    expect(repeat?.differing).toBe(5)
    expect(check.identicalSets.differing).toBe(5)
    expect(check.differentSets.differing).toBe(0)
  })

  it('says when a difference changes the order, which is what a ranking would feel', async () => {
    const { provider } = fakeProvider()
    let seen = 0
    const flipped: RerankProvider = {
      ...provider,
      rerank: async (query, sent) => {
        const result = await provider.rerank(query, sent)
        seen++
        // The second call is the repeat: its scores come back on the wrong documents.
        return seen === 2 ? { ...result, scores: [...result.scores].reverse() } : result
      },
    }
    const check = await runBatchingCheck([question], options(flipped))
    const repeat = check.questions[0]?.compositions.find(({ name }) => name === 'repeat')
    expect(repeat?.orderChanged).toBe(true)
    expect(check.questions[0]?.compositions.at(-1)?.orderChanged).toBe(false)
  })

  it('records what each request billed', async () => {
    const { provider } = fakeProvider()
    const meter = new UsageMeter()
    await runBatchingCheck([question], { ...options(provider), meter })
    const [entry] = meter.entries()
    expect(entry?.[0]).toBe('fake-rerank')
    expect(entry?.[1]).toMatchObject({
      kind: 'rerank',
      requests: 11,
      inputTokens: planBatchingCheck([question], 70).estimatedTokens,
    })
  })
})
