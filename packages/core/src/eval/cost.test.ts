import { openEvalCache, type EvalCache } from '@docs-rag-lab/db'
import type { PricingSettings } from '@docs-rag-lab/settings'
import { afterEach, describe, expect, it } from 'vitest'

import { requestKey, rowRequest, type AnswerJob, type EvalClient } from './answers.ts'
import { estimateCost } from './cost.ts'
import { parseGoldenSet, type GoldenQuestion } from './golden.ts'

const pricing: PricingSettings = {
  checked: '2026-11-03',
  sources: [],
  models: { answer: { input: 2, output: 10 }, judge: { input: 4, output: 20 } },
}
const settings = { model: 'answer', effort: 'low', maxTokens: 100 } as const

const [answerable, refused] = parseGoldenSet(
  [
    { id: 'ts-0001', question: 'First?', answer: 'A.', primary: ['a.md'], tags: ['basic'] },
    { id: 'ts-0002', question: 'Not covered?', answer: 'No.', tags: ['unanswerable'] },
  ]
    .map((row) => JSON.stringify(row))
    .join('\n'),
) as [GoldenQuestion, GoldenQuestion]

function job(question: GoldenQuestion, row: 0 | 2 | 3, sample = 1): AnswerJob {
  const request = rowRequest(row, 'demo', question.question, [], settings)
  return { question, row, sample, hits: [], request, key: requestKey(request, sample) }
}

function client() {
  const counted: { model: string; system?: unknown }[] = []
  const fake: EvalClient = {
    messages: {
      stream: () => {
        throw new Error('an estimate must not make a paid call')
      },
      countTokens: (params) => {
        counted.push(params)
        return Promise.resolve({ input_tokens: 1000 })
      },
    },
  }
  return { fake, counted }
}

let cache: EvalCache | undefined

afterEach(() => {
  cache?.close()
  cache = undefined
})

function estimate(jobs: AnswerJob[], fake: EvalClient, retest = false) {
  cache ??= openEvalCache(':memory:')
  return estimateCost({
    jobs,
    client: fake,
    cache,
    pricing,
    answerModel: 'answer',
    judgeModel: 'judge',
    retest,
  })
}

describe('estimateCost', () => {
  it('counts input with the free endpoint, and makes no paid call', async () => {
    const { fake, counted } = client()

    const result = await estimate([job(answerable, 3)], fake)

    expect(counted).toHaveLength(1)
    expect(counted[0]?.model).toBe('answer')
    expect(result.answers).toMatchObject({ calls: 1, cached: 0, inputTokens: 1000 })
    expect(result.assumed).toBe(true)
    expect(result.pricesChecked).toBe('2026-11-03')
  })

  it('prices answers and the judge each at their own model', async () => {
    const result = await estimate([job(answerable, 0)], client().fake)

    // 1000 in at $2, 500 out at $10; one verdict: 1500 in at $4, 800 out at $20.
    expect(result.answers.usd).toBeCloseTo(0.007)
    expect(result.judge.usd).toBeCloseTo(0.022)
    expect(result.usd).toBeCloseTo(0.029)
  })

  it('counts a verdict per answer, and a support check only where citations can be', async () => {
    const result = await estimate(
      [job(answerable, 0), job(answerable, 3), job(refused, 0), job(refused, 3)],
      client().fake,
    )

    // 4 verdicts, and support for row 3 on the answerable question only.
    expect(result.judge.calls).toBe(5)
  })

  it('adds second opinions on row 3 first answers in a noise run', async () => {
    const result = await estimate([job(answerable, 3), job(answerable, 3, 2)], client().fake, true)

    // 2 verdicts, 2 support checks, and one second opinion.
    expect(result.judge.calls).toBe(5)
  })

  it('charges nothing for what the cache already holds', async () => {
    const { fake, counted } = client()
    const cached = job(answerable, 3)
    cache = openEvalCache(':memory:')
    cache.put(cached.key, 'answer', { value: {}, inputTokens: 1, outputTokens: 1 })

    const result = await estimate([cached], fake)

    expect(counted).toHaveLength(0)
    expect(result.answers).toMatchObject({ calls: 1, cached: 1, inputTokens: 0, usd: 0 })
    expect(result.judge).toMatchObject({ calls: 0, usd: 0 })
  })

  it('uses what past calls measured, once there are enough of them', async () => {
    cache = openEvalCache(':memory:')
    for (let i = 0; i < 5; i++) {
      cache.put(`a${String(i)}`, 'answer', { value: {}, inputTokens: 1, outputTokens: 100 })
      cache.put(`j${String(i)}`, 'judge', { value: {}, inputTokens: 200, outputTokens: 300 })
    }

    const result = await estimate([job(answerable, 0)], client().fake)

    expect(result.assumed).toBe(false)
    expect(result.answers.outputTokens).toBe(100)
    expect(result.judge).toMatchObject({ inputTokens: 200, outputTokens: 300 })
  })

  it('stays on the assumptions until both kinds have enough calls', async () => {
    cache = openEvalCache(':memory:')
    for (let i = 0; i < 4; i++) {
      cache.put(`j${String(i)}`, 'judge', { value: {}, inputTokens: 200, outputTokens: 300 })
    }

    const result = await estimate([job(answerable, 0)], client().fake)

    expect(result.assumed).toBe(true)
    expect(result.judge.outputTokens).toBe(800)
  })

  it('refuses a model with no price, rather than calling it free', async () => {
    cache = openEvalCache(':memory:')

    await expect(
      estimateCost({
        jobs: [job(answerable, 0)],
        client: client().fake,
        cache,
        pricing,
        answerModel: 'unknown',
        judgeModel: 'judge',
        retest: false,
      }),
    ).rejects.toThrow('no price')
  })
})
