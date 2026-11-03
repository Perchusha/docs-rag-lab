import type Anthropic from '@anthropic-ai/sdk'
import type { EvalAnswer } from '@docs-rag-lab/contracts'
import { openEvalCache, type EvalCache, type SearchHit } from '@docs-rag-lab/db'
import type { PricingSettings } from '@docs-rag-lab/settings'
import { afterEach, describe, expect, it } from 'vitest'

import type { Engine } from '../engine.ts'
import { ANSWER_SYSTEM_PROMPT } from '../generate.ts'
import { UsageMeter } from '../usage.ts'
import {
  claimsOf,
  EvalStoppedError,
  noRagSystemPrompt,
  planAnswers,
  requestKey,
  rowRequest,
  runAnswers,
  runJudge,
  type AnswerJob,
  type EvalClient,
} from './answers.ts'
import { parseGoldenSet, type GoldenQuestion } from './golden.ts'

const MODEL = 'claude-test'
const JUDGE = 'claude-judge'
const pricing: PricingSettings = {
  checked: '2026-11-03',
  sources: [],
  models: { [MODEL]: { input: 1, output: 1 }, [JUDGE]: { input: 1, output: 1 } },
}
const settings = { model: MODEL, effort: 'low', maxTokens: 100 } as const
const judge = { model: JUDGE, effort: 'medium', maxTokens: 100 } as const

const [answerable, refused] = parseGoldenSet(
  [
    { id: 'ts-0001', question: 'First?', answer: 'A.', primary: ['a.md'], tags: ['basic'] },
    { id: 'ts-0002', question: 'Not covered?', answer: 'No.', tags: ['unanswerable'] },
  ]
    .map((row) => JSON.stringify(row))
    .join('\n'),
) as [GoldenQuestion, GoldenQuestion]

const hit = (chunkId: string): SearchHit => ({
  chunkId,
  text: `text of ${chunkId}`,
  docPath: 'a.md',
  url: 'https://x.dev/a',
  title: 'A',
  headingPath: [],
  anchor: '',
  blockTypes: ['prose'],
  metadata: {},
  tokenCount: 1,
  docType: 'handbook',
})

function message(overrides: Partial<Anthropic.Message> = {}): Anthropic.Message {
  return {
    id: 'm',
    type: 'message',
    role: 'assistant',
    model: MODEL,
    content: [{ type: 'text', text: 'An answer.', citations: null }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
    ...overrides,
  } as Anthropic.Message
}

type Reply = Anthropic.Message | Error

function fakeClient(reply: (request: Anthropic.MessageCreateParamsNonStreaming) => Reply) {
  const requests: Anthropic.MessageCreateParamsNonStreaming[] = []
  const client: EvalClient = {
    messages: {
      stream(request) {
        requests.push(request)
        const result = reply(request)
        return {
          on: () => undefined,
          finalMessage: () =>
            result instanceof Error ? Promise.reject(result) : Promise.resolve(result),
          currentMessage: result instanceof Error ? undefined : result,
        }
      },
      countTokens: () => Promise.resolve({ input_tokens: 10 }),
    },
  }
  return { client, requests }
}

let cache: EvalCache | undefined

afterEach(() => {
  cache?.close()
  cache = undefined
})

function options(client: EvalClient, maxUsd = 100) {
  cache ??= openEvalCache(':memory:')
  return {
    client,
    cache,
    pricing,
    meter: new UsageMeter(),
    maxUsd,
    concurrency: 1,
    now: () => 0,
  }
}

function job(question: GoldenQuestion = answerable, sample = 1, row: 0 | 2 | 3 = 3): AnswerJob {
  const hits = row === 0 ? [] : [hit('c1')]
  const request = rowRequest(row, 'demo', question.question, hits, settings)
  return { question, row, sample, hits, request, key: requestKey(request, sample) }
}

describe('rowRequest', () => {
  it('row 0 sends the question alone, with a prompt of its own', () => {
    const request = rowRequest(0, 'typescript', 'First?', [], settings)

    expect(request.system).toBe(noRagSystemPrompt('typescript'))
    expect(request.system).toContain('typescript documentation')
    expect(request.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'First?' }] },
    ])
    expect(request.output_config).toEqual({ effort: 'low' })
  })

  it('other rows send the search results, with the prompt the app uses', () => {
    const request = rowRequest(3, 'typescript', 'First?', [hit('c1')], settings)
    const content = request.messages[0]?.content as { type: string }[]

    expect(request.system).toBe(ANSWER_SYSTEM_PROMPT)
    expect(content.map((block) => block.type)).toEqual(['search_result', 'text'])
  })
})

describe('requestKey', () => {
  const request = rowRequest(0, 'demo', 'First?', [], settings)

  it.each([
    ['the question', rowRequest(0, 'demo', 'Other?', [], settings)],
    ['the model', rowRequest(0, 'demo', 'First?', [], { ...settings, model: 'other' })],
    ['the effort', rowRequest(0, 'demo', 'First?', [], { ...settings, effort: 'high' })],
    ['max_tokens', rowRequest(0, 'demo', 'First?', [], { ...settings, maxTokens: 7 })],
    ['the prompt', { ...request, system: 'Another prompt.' }],
    ['the context', rowRequest(3, 'demo', 'First?', [hit('c1')], settings)],
  ])('changes with %s', (_name, other) => {
    expect(requestKey(other, 1)).not.toBe(requestKey(request, 1))
  })

  it('changes with the sample, and not otherwise', () => {
    expect(requestKey(request, 2)).not.toBe(requestKey(request, 1))
    expect(requestKey(rowRequest(0, 'demo', 'First?', [], settings), 1)).toBe(
      requestKey(request, 1),
    )
  })
})

describe('claimsOf', () => {
  const citation = (index: number, text: string) => ({
    type: 'search_result_location',
    search_result_index: index,
    cited_text: text,
    source: 's',
    title: 't',
    start_block_index: 0,
    end_block_index: 1,
  })

  it('keeps every citation, also several to one source, and skips text that cites nothing', () => {
    const claims = claimsOf(
      {
        content: [
          { type: 'text', text: 'Uncited.', citations: null },
          {
            type: 'text',
            text: 'Cited.',
            citations: [citation(0, 'first'), citation(0, 'second'), citation(1, 'third')],
          },
        ],
      } as unknown as Anthropic.Message,
      [{ chunkId: 'a' }, { chunkId: 'b' }],
    )

    expect(claims).toEqual([
      {
        text: 'Cited.',
        citations: [
          { chunkId: 'a', citedText: 'first' },
          { chunkId: 'a', citedText: 'second' },
          { chunkId: 'b', citedText: 'third' },
        ],
      },
    ])
  })

  it('refuses a citation of something that was not in the context', () => {
    expect(() =>
      claimsOf(
        {
          content: [{ type: 'text', text: 'x', citations: [citation(3, 'y')] }],
        } as unknown as Anthropic.Message,
        [{ chunkId: 'a' }],
      ),
    ).toThrow('search result 3')
  })
})

describe('planAnswers', () => {
  function engine() {
    const strategies: (string | undefined)[] = []
    const embedded: string[][] = []
    const fake = {
      embedQueries: (request: { questions: string[] }) => {
        embedded.push(request.questions)
        return Promise.resolve([])
      },
      search: (request: { strategy?: string }) => {
        strategies.push(request.strategy)
        return Promise.resolve({ hits: [hit(request.strategy ?? 'none')] })
      },
    } as unknown as Engine
    return { fake, strategies, embedded }
  }

  it('searches with the strategy of each row, and not at all for row 0', async () => {
    const { fake, strategies, embedded } = engine()

    const jobs = await planAnswers({
      engine: fake,
      sourceId: 'demo',
      questions: [answerable],
      rows: [0, 2, 3],
      noise: false,
      settings,
      meter: new UsageMeter(),
    })

    expect(embedded).toEqual([['First?']])
    expect(strategies).toEqual(['vector', 'hybrid'])
    expect(jobs.map((item) => [item.row, item.hits.map((h) => h.chunkId)])).toEqual([
      [0, []],
      [2, ['vector']],
      [3, ['hybrid']],
    ])
  })

  it('embeds nothing for row 0 alone', async () => {
    const { fake, embedded } = engine()

    await planAnswers({
      engine: fake,
      sourceId: 'demo',
      questions: [answerable],
      rows: [0],
      noise: false,
      settings,
      meter: new UsageMeter(),
    })

    expect(embedded).toEqual([])
  })

  it('a noise run sends row 3 twice, under two keys, and no other row', async () => {
    const jobs = await planAnswers({
      engine: engine().fake,
      sourceId: 'demo',
      questions: [answerable],
      rows: [2, 3],
      noise: true,
      settings,
      meter: new UsageMeter(),
    })

    expect(jobs.map((item) => [item.row, item.sample])).toEqual([
      [2, 1],
      [3, 1],
      [3, 2],
    ])
    expect(jobs[1]?.request).toEqual(jobs[2]?.request)
    expect(jobs[1]?.key).not.toBe(jobs[2]?.key)
  })
})

describe('runAnswers', () => {
  it('pays once: a second run reads the cache', async () => {
    const { client, requests } = fakeClient(() => message())
    const run = options(client)

    const [first] = await runAnswers([job()], run)
    const [second] = await runAnswers([job()], run)

    expect(requests).toHaveLength(1)
    expect(first).toMatchObject({ status: 'ok', text: 'An answer.', fromCache: false })
    expect(second).toMatchObject({ status: 'ok', text: 'An answer.', fromCache: true })
    expect(second?.costUsd).toBe(first?.costUsd)
    expect(run.meter.estimateCost(pricing).total).toBeCloseTo(15 / 1_000_000)
  })

  it('never turns an API error into an answer, does not cache it, and goes on', async () => {
    let calls = 0
    const { client } = fakeClient(() => {
      calls++
      return calls === 1 ? new Error('overloaded') : message()
    })
    const run = options(client)

    const [failed] = await runAnswers([job()], run)
    const [retried] = await runAnswers([job()], run)

    expect(failed).toMatchObject({ status: 'failed', error: 'overloaded', text: '', costUsd: 0 })
    expect(retried).toMatchObject({ status: 'ok' })
  })

  it.each([
    ['max_tokens', 'truncated'],
    ['refusal', 'refused'],
    ['end_turn', 'ok'],
  ] as const)('marks stop reason %s as %s', async (stopReason, status) => {
    const { client } = fakeClient(() => message({ stop_reason: stopReason }))

    const [answer] = await runAnswers([job()], options(client))

    expect(answer).toMatchObject({ status, stopReason })
  })

  it('refuses an answer from another model, and does not cache it', async () => {
    const { client, requests } = fakeClient(() => message({ model: 'other' }))
    const run = options(client)

    const [answer] = await runAnswers([job()], run)
    await runAnswers([job()], run)

    expect(answer).toMatchObject({ status: 'failed' })
    expect(answer?.error).toContain('other answered')
    expect(requests).toHaveLength(2)
  })

  it('leaves thinking out of what it stores', async () => {
    const { client } = fakeClient(() =>
      message({
        content: [
          { type: 'thinking', thinking: 'hm', signature: 's' },
          { type: 'text', text: 'Said.', citations: null },
        ] as Anthropic.ContentBlock[],
      }),
    )

    const [answer] = await runAnswers([job()], options(client))

    expect(answer?.text).toBe('Said.')
    expect(answer?.blocks).toEqual([{ type: 'text', text: 'Said.', citations: null }])
  })

  it('stops before the next paid call at the limit, and keeps what it paid for', async () => {
    const { client, requests } = fakeClient(() => message())
    const run = options(client, 10 / 1_000_000)

    await expect(runAnswers([job(), job(refused)], run)).rejects.toThrow(EvalStoppedError)
    expect(requests).toHaveLength(1)

    const { client: another } = fakeClient(() => message())
    const [answer] = await runAnswers([job()], options(another))
    expect(answer?.fromCache).toBe(true)
  })

  it('stops after 5 failures in a row, which is not about one bad request', async () => {
    const { client, requests } = fakeClient(() => new Error('401'))
    const jobs = Array.from({ length: 8 }, (_, i) => job(answerable, i + 1))

    await expect(runAnswers(jobs, options(client))).rejects.toThrow('5 failures in a row')
    expect(requests).toHaveLength(5)
  })

  it('returns answers in a stable order, however they finish', async () => {
    const { client } = fakeClient(() => message())

    const answers = await runAnswers(
      [job(refused), job(answerable, 2), job(answerable, 1, 0), job(answerable, 1)],
      { ...options(client), concurrency: 4 },
    )

    expect(answers.map(({ questionId, row, sample }) => [questionId, row, sample])).toEqual([
      ['ts-0001', 0, 1],
      ['ts-0001', 3, 1],
      ['ts-0001', 3, 2],
      ['ts-0002', 3, 1],
    ])
  })
})

describe('runJudge', () => {
  const questions = new Map([
    [answerable.id, answerable],
    [refused.id, refused],
  ])

  const answer = (overrides: Partial<EvalAnswer> = {}): EvalAnswer => ({
    questionId: 'ts-0001',
    row: 3,
    sample: 1,
    status: 'ok',
    model: MODEL,
    stopReason: 'end_turn',
    text: 'An answer.',
    blocks: [],
    claims: [{ text: 'Cited.', citations: [{ chunkId: 'c1', citedText: 'passage' }] }],
    context: ['c1'],
    inputTokens: 1,
    outputTokens: 1,
    costUsd: 0,
    latencyMs: 1,
    firstTokenMs: 1,
    fromCache: false,
    ...overrides,
  })

  const judgeReply = (request: Anthropic.MessageCreateParamsNonStreaming): Reply => {
    const text = JSON.stringify(request.messages)
    const system = JSON.stringify(request.system)
    let body: unknown
    if (system.includes('You check the citations')) {
      body = { claims: [{ claim: 1, reason: 'yes', supported: true }] }
    } else if (system.includes('does not answer the question below')) {
      body = { reasoning: 'r', outcome: text.includes('No.') ? 'correct_refusal' : 'wrong' }
    } else {
      body = { reasoning: 'r', correctness: 2, false_refusal: false }
    }
    return message({
      model: JUDGE,
      content: [{ type: 'text', text: JSON.stringify(body), citations: null }],
    })
  }

  const run = (client: EvalClient, retest = false) => ({
    ...options(client),
    judge,
    questions,
    retest,
  })

  it('grades correctness, and checks the citations in a separate call', async () => {
    const { client, requests } = fakeClient(judgeReply)

    const { verdicts, support } = await runJudge([answer()], run(client))

    expect(requests).toHaveLength(2)
    expect(verdicts).toEqual([
      expect.objectContaining({ correctness: 2, falseRefusal: false, outcome: null, status: 'ok' }),
    ])
    expect(support).toEqual([
      expect.objectContaining({
        status: 'ok',
        claims: [{ supported: true, reason: 'yes' }],
      }),
    ])
  })

  it('grades a question the docs do not answer as a refusal, not a score', async () => {
    const { client, requests } = fakeClient(judgeReply)

    const { verdicts, support } = await runJudge(
      [answer({ questionId: 'ts-0002', claims: [] })],
      run(client),
    )

    expect(requests).toHaveLength(1)
    expect(verdicts[0]).toMatchObject({
      outcome: 'correct-refusal',
      correctness: null,
      falseRefusal: null,
    })
    expect(support).toEqual([])
  })

  it('tells the judge nothing about the row or the strategy', async () => {
    const { client, requests } = fakeClient(judgeReply)

    await runJudge([answer({ row: 2 })], run(client))

    for (const request of requests) {
      const text = JSON.stringify(request).toLowerCase()
      expect(text).not.toMatch(/vector|hybrid|\brow\b/)
    }
  })

  it('gives two rows with the same text one verdict, since it cannot tell them apart', async () => {
    const { client, requests } = fakeClient(judgeReply)

    const { verdicts } = await runJudge(
      [answer({ row: 2, claims: [] }), answer({ row: 3, claims: [] })],
      run(client),
    )

    expect(requests).toHaveLength(1)
    expect(verdicts.map(({ row, correctness }) => [row, correctness])).toEqual([
      [2, 2],
      [3, 2],
    ])
  })

  it.each(['truncated', 'refused', 'failed'] as const)(
    'leaves a %s answer alone',
    async (status) => {
      const { client, requests } = fakeClient(judgeReply)

      const { verdicts, support } = await runJudge([answer({ status })], run(client))

      expect(requests).toHaveLength(0)
      expect(verdicts).toEqual([])
      expect(support).toEqual([])
    },
  )

  it('asks a second time about row 3 only, under another key, on a retest', async () => {
    const { client, requests } = fakeClient(judgeReply)

    const { verdicts } = await runJudge(
      [answer({ claims: [] }), answer({ row: 2, text: 'Other.', claims: [] })],
      run(client, true),
    )

    expect(requests).toHaveLength(3)
    expect(verdicts.map(({ row, judgeSample }) => [row, judgeSample])).toEqual([
      [2, 1],
      [3, 1],
      [3, 2],
    ])
  })

  it('records a verdict it cannot read as failed, not as a score', async () => {
    const { client } = fakeClient(() =>
      message({
        model: JUDGE,
        content: [{ type: 'text', text: 'not json', citations: null }],
      }),
    )

    const { verdicts, support } = await runJudge([answer()], run(client))

    expect(verdicts[0]).toMatchObject({ status: 'failed', correctness: null })
    expect(verdicts[0]?.error).toContain('not JSON')
    expect(support[0]).toMatchObject({ status: 'failed', claims: [] })
  })

  it('pays once for a verdict', async () => {
    const { client, requests } = fakeClient(judgeReply)
    const options_ = run(client)

    await runJudge([answer()], options_)
    await runJudge([answer()], options_)

    expect(requests).toHaveLength(2)
  })
})
