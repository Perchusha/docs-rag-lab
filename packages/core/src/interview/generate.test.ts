import type Anthropic from '@anthropic-ai/sdk'
import type { InterviewBankSettings, PricingSettings } from '@docs-rag-lab/settings'
import type { Source } from '@docs-rag-lab/source-kit'
import { describe, expect, it } from 'vitest'

import type { AnswerClient } from '../generate.ts'
import { UsageMeter } from '../usage.ts'
import {
  bankIdentity,
  BankStoppedError,
  CHECK_SYSTEM_PROMPT,
  checkRequest,
  chunkKey,
  draftOf,
  forecastBank,
  generateBank,
  generatedChunks,
  GENERATE_SYSTEM_PROMPT,
  generateRequest,
  bankPilotChunks,
  planBank,
  type RawQuestion,
} from './generate.ts'
import type { BankRow, QuestionRow } from './store.ts'
import { testChunk, testDocument } from './test-chunks.ts'

const GENERATE = 'claude-small'
const CHECK = 'claude-checker'
const models = { generate: GENERATE, check: CHECK }

const settings: InterviewBankSettings = {
  generate: { effort: 'low', maxTokens: 2_000 },
  check: { effort: 'low', maxTokens: 2_000 },
  concurrency: 2,
  minCacheableTokens: 100,
  maxUsd: 10,
}

const pricing: PricingSettings = {
  checked: '2026-11-08',
  sources: [],
  models: {
    [GENERATE]: { input: 1, output: 5, cacheWrite5m: 1.25, cacheRead: 0.1 },
    [CHECK]: { input: 2, output: 10, cacheWrite5m: 2.5, cacheRead: 0.2 },
  },
}

const source: Source = {
  id: 'react',
  repo: 'r',
  branch: 'b',
  include: [],
  license: { name: 'l', url: 'u', attribution: 'a' },
  parserVersion: 1,
  match: () => true,
  parse: () => Promise.reject(new Error('not parsed in this test')),
  displayCode: (code) => {
    const clean = code.replace('// @noErrors\n', '')
    const [setup, shown] = clean.split('// ---cut---\n')
    return shown === undefined
      ? { code: clean, setup: '' }
      : { code: shown, setup: (setup ?? '').trim() }
  },
}

const prose = (id: string) =>
  `The state of ${id} is a snapshot: setting it asks for a new render and does not change the value in the running code. ${'More words. '.repeat(30)}`
const PITFALL =
  '[Pitfall]\n\nCalling a hook inside a loop breaks the order React relies on.\n\n```js\nfor (const x of xs) useState(x)\n```'

const several = testDocument('learn/state.md', [
  testChunk('s1', [
    prose('s1'),
    '```js src/App.js\n// @noErrors\nconst [n, setN] = useState(0)\n```',
  ]),
  testChunk('s2', [prose('s2')]),
  testChunk('s3', [prose('s3')]),
])
const single = testDocument(
  'learn/hooks.md',
  [testChunk('h1', [prose('h1'), PITFALL])],
  'learn/hooks',
)

/** What the generator wrote for one chunk, by the chunk's ID found in its text. */
type Generation = (
  chunkText: string,
) => Partial<RawQuestion>[] | { stop: Anthropic.Message['stop_reason'] }

const goodQuestion = (chunkText: string): Partial<RawQuestion> => {
  const id = /The state of (\w+)/.exec(chunkText)?.[1] ?? 'x'
  return {
    kind: 'theory',
    question: `What happens to the value of ${id} after setting it?`,
    answer: 'It stays the same in the running code, and the next render sees the new one.',
    quote: `The state of ${id} is a snapshot: setting it asks for a new render`,
    code_block: 0,
  }
}

/** A Claude client that writes questions and checks them, and records what it was asked. */
function fakeClient(
  generation: Generation = (text) => [goodQuestion(text)],
  verdict: (question: string) => { answerable: boolean; correct: boolean } = () => ({
    answerable: true,
    correct: true,
  }),
) {
  const requests: Anthropic.MessageCreateParamsNonStreaming[] = []
  const finishedAtStart: number[] = []
  let finished = 0
  const textOf = (request: Anthropic.MessageCreateParamsNonStreaming, block: number): string => {
    const content = request.messages[0]?.content
    const part = Array.isArray(content) ? content[block] : undefined
    return part?.type === 'text' ? part.text : ''
  }
  const client: AnswerClient = {
    messages: {
      stream(request) {
        requests.push(request)
        finishedAtStart.push(finished)
        return {
          on: () => undefined,
          currentMessage: undefined,
          finalMessage: async () => {
            await new Promise((resolve) => setTimeout(resolve, 1))
            finished++
            let text: string
            let stop: Anthropic.Message['stop_reason'] = 'end_turn'
            if (request.model === GENERATE) {
              const written = generation(textOf(request, 1))
              if ('stop' in written) stop = written.stop
              text = JSON.stringify({ questions: 'stop' in written ? [] : written })
            } else {
              const asked = [...textOf(request, 0).matchAll(/<text>(.*?)<\/text>/g)].map(
                (m) => m[1] ?? '',
              )
              text = JSON.stringify({
                verdicts: asked.map((question, i) => ({
                  question: i + 1,
                  reason: `Reason ${String(i + 1)}.`,
                  ...verdict(question),
                })),
              })
            }
            return {
              stop_reason: stop,
              content: [{ type: 'text', text, citations: null }],
              usage: {
                input_tokens: 100,
                output_tokens: 50,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: 0,
              },
            } as unknown as Anthropic.Message
          },
        }
      },
    },
  }
  return { client, requests, finishedAtStart }
}

function run(
  documents: Parameters<typeof generateBank>[0],
  fake: ReturnType<typeof fakeClient>,
  overrides: Partial<Parameters<typeof generateBank>[1]> = {},
) {
  const rows: BankRow[] = []
  const meter = new UsageMeter()
  const options = {
    source,
    client: fake.client,
    models,
    settings,
    pricing,
    meter,
    known: new Set<string>(),
    onRows: (chunkRows: BankRow[]) => rows.push(...chunkRows),
    ...overrides,
  }
  return { rows, meter, done: generateBank(documents, options) }
}

const questionRows = (rows: readonly BankRow[]): QuestionRow[] =>
  rows.filter((row): row is QuestionRow => row.row === 'question')

describe('the bank requests (ADR-0018)', () => {
  it('sends the document under a cache entry, then the chunk with its code blocks and callouts', () => {
    const chunk = single.chunks[0] ?? testChunk('none', [])
    const request = generateRequest(
      GENERATE,
      settings,
      { title: 'Hooks', text: 'Whole doc.' },
      chunk,
      true,
    )

    expect(request.system).toBe(GENERATE_SYSTEM_PROMPT)
    expect(request.thinking).toEqual({ type: 'disabled' })
    expect(request.output_config?.format?.type).toBe('json_schema')
    const content = request.messages[0]?.content
    expect(Array.isArray(content) && content[0]).toMatchObject({
      text: '<document title="Hooks">\nWhole doc.\n</document>',
      cache_control: { type: 'ephemeral' },
    })
    const notes = Array.isArray(content) && content[1]?.type === 'text' ? content[1].text : ''
    expect(notes).toContain(`<chunk>\n${chunk.text}\n</chunk>`)
    expect(notes).toContain('1. (js) for (const x of xs) useState(x)')
    expect(notes).toContain('Pitfall callouts in the chunk: 1.')
    const uncached = generateRequest(GENERATE, settings, { title: 'H', text: '' }, chunk, false)
    const first = uncached.messages[0]?.content
    expect(Array.isArray(first) ? first[0] : undefined).not.toHaveProperty('cache_control')
  })

  it('checks a chunk with its instructions cached, its questions numbered and their code shown', () => {
    const request = checkRequest(CHECK, settings, { text: 'The chunk.' }, [
      { kind: 'theory', question: 'Q one?', answer: 'A one.', quote: 'q' },
      {
        kind: 'pitfall',
        question: 'Q two?',
        answer: 'A two.',
        quote: 'q',
        code: { lang: 'js', code: 'f()', compiled: false },
      },
    ])

    expect(request.system).toEqual([
      { type: 'text', text: CHECK_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ])
    expect(request.thinking).toEqual({ type: 'between_tools' })
    const content = request.messages[0]?.content
    const text = Array.isArray(content) && content[0]?.type === 'text' ? content[0].text : ''
    expect(text).toBe(
      '<chunk>\nThe chunk.\n</chunk>\n<question number="1">\n<text>Q one?</text>\n<answer>A one.</answer>\n</question>\n<question number="2">\n<text>Q two?</text>\n<code>\nf()\n</code>\n<answer>A two.</answer>\n</question>',
    )
  })

  it('names its models and prompts, and changes when one of them does', () => {
    const identity = bankIdentity(models, settings)

    expect(identity.generator).toMatch(/^claude-small:[0-9a-f]{12}$/)
    expect(identity.checker).toMatch(/^claude-checker:[0-9a-f]{12}$/)
    expect(bankIdentity(models, { ...settings })).toEqual(identity)
    expect(
      bankIdentity(models, { ...settings, generate: { effort: 'high', maxTokens: 2_000 } })
        .generator,
    ).not.toBe(identity.generator)
    expect(
      bankIdentity(models, { ...settings, check: { effort: 'high', maxTokens: 2_000 } }).generator,
    ).toBe(identity.generator)
  })
})

describe('draftOf', () => {
  const chunk = several.chunks[0] ?? testChunk('none', [])
  const raw = (overrides: Partial<RawQuestion>): RawQuestion => ({
    ...(goodQuestion(chunk.text) as RawQuestion),
    ...overrides,
  })

  it('shows the code block it names as the docs have it, through the source', () => {
    const { draft, status } = draftOf(source, chunk, raw({ code_block: 1 }))

    expect(status).toBe('pending')
    expect(draft.code).toEqual({
      lang: 'js',
      code: 'const [n, setN] = useState(0)',
      compiled: false,
    })
  })

  it('drops a question whose code block does not exist, or whose quote is not in the chunk', () => {
    expect(draftOf(source, chunk, raw({ code_block: 2 })).status).toBe('dropped-code')
    expect(draftOf(source, chunk, raw({ code_block: -1 })).status).toBe('dropped-code')
    expect(
      draftOf(source, chunk, raw({ quote: 'A sentence the chunk never had in it.' })).status,
    ).toBe('dropped-quote')
  })

  it('makes a pitfall question on a chunk with no Pitfall callout a theory question', () => {
    expect(draftOf(source, chunk, raw({ kind: 'pitfall' })).draft.kind).toBe('theory')
    const pitfallChunk = single.chunks[0] ?? testChunk('none', [])
    const onCallout = draftOf(source, pitfallChunk, {
      kind: 'pitfall',
      question: 'Why not call a hook in a loop?',
      answer: 'It breaks the order.',
      quote: 'Calling a hook inside a loop breaks the order React relies on.',
      code_block: 1,
    })
    expect(onCallout).toMatchObject({
      status: 'pending',
      draft: { kind: 'pitfall', code: { code: 'for (const x of xs) useState(x)' } },
    })
  })

  it('marks code the compiler ran on', () => {
    const compiled = testChunk('c', [
      '```ts\nlet a = 1\n```\n\nCompiler output:\n- Type of `a`: `let a: number`',
    ])
    const { draft } = draftOf(source, compiled, {
      ...raw({}),
      quote: 'Compiler output: - Type of a: let a: number',
      code_block: 1,
    })

    expect(draft.code?.compiled).toBe(true)
  })

  it('keeps what the site hides of the block as its setup', () => {
    const withSetup = testChunk('c', [
      prose('c'),
      '```ts\ndeclare const x: string\n// ---cut---\nx.length\n```',
    ])
    const { draft } = draftOf(source, withSetup, {
      ...raw({}),
      quote: prose('c').slice(0, 60),
      code_block: 1,
    })

    expect(draft.code).toEqual({
      lang: 'ts',
      code: 'x.length',
      setup: 'declare const x: string',
      compiled: false,
    })
  })
})

describe('planBank', () => {
  it('counts a document of several chunks as one cache write and reads, and the rest as uncached', () => {
    const plan = planBank([several, single], { models, settings, pricing, known: new Set() })

    expect(plan.chunks).toBe(4)
    expect(plan.documents).toBe(2)
    expect(plan.generate.cacheWrite).toBeGreaterThan(0)
    expect(plan.generate.cacheRead).toBe(plan.generate.cacheWrite * 2)
    expect(plan.generate.output).toBe(4 * 350)
    expect(plan.usd).toBeCloseTo(plan.generate.usd + plan.check.usd, 10)
  })

  it('leaves out chunks already read, and keeps to a pilot', () => {
    const known = new Set([chunkKey(several.chunks[0] ?? testChunk('none', []))])

    expect(planBank([several, single], { models, settings, pricing, known }).chunks).toBe(3)
    expect(
      planBank([several, single], {
        models,
        settings,
        pricing,
        known: new Set(),
        only: new Set(['h1']),
      }).chunks,
    ).toBe(1)
  })

  it('forecasts the whole from what a pilot spent against its own plan', () => {
    const whole = planBank([several, single], { models, settings, pricing, known: new Set() })
    const pilot = planBank([several], { models, settings, pricing, known: new Set() })
    const used = new Map([
      [GENERATE, { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 }],
      [CHECK, { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 }],
    ])

    expect(forecastBank(whole, pilot, used, models, pricing).usd).toBe(0)
    const doubled = {
      inputTokens: pilot.check.uncached * 2,
      outputTokens: pilot.check.output * 2,
      cacheWriteTokens: pilot.check.cacheWrite * 2,
      cacheReadTokens: pilot.check.cacheRead * 2,
    }
    const forecast = forecastBank(whole, pilot, new Map([[CHECK, doubled]]), models, pricing)
    expect(forecast.checkAgainstPlan).toBeCloseTo(2, 10)
    expect(forecast.usd).toBeCloseTo(whole.check.usd * 2, 10)
  })
})

describe('bankPilotChunks', () => {
  it('takes a chunk with a Pitfall callout, then chunks of documents with several', () => {
    expect([...bankPilotChunks([several, single], new Set(), 3)]).toEqual(['h1', 's1', 's2'])
  })
})

describe('generateBank (ADR-0018)', () => {
  it('writes the first chunk of a document before the others start, as the cache needs', async () => {
    const fake = fakeClient()
    const { done } = run([several], fake)
    await done

    const generations = fake.requests.map(
      (request, i) => [request.model, fake.finishedAtStart[i]] as const,
    )
    expect(generations[0]).toEqual([GENERATE, 0])
    expect(generations.slice(1).every(([, finished]) => (finished ?? 0) >= 1)).toBe(true)
  })

  it('keeps what both checks pass, and says why the rest was dropped', async () => {
    const fake = fakeClient(
      (text) =>
        text.includes('The state of s1')
          ? [
              goodQuestion(text),
              { ...goodQuestion(text), quote: 'Nothing like this is in the chunk at all.' },
              { ...goodQuestion(text), question: 'Off topic?' },
            ]
          : [],
      (question) => ({ answerable: question !== 'Off topic?', correct: true }),
    )
    const { rows, done } = run([several], fake)
    await done

    const s1 = questionRows(rows).filter((row) => row.question.citation.chunkId === 's1')
    expect(s1.map((row) => [row.status, row.reason])).toEqual([
      ['shown', 'Reason 1.'],
      ['dropped-quote', undefined],
      ['dropped-check', 'Reason 2.'],
    ])
    expect(s1[0]?.question).toMatchObject({
      kind: 'theory',
      source: 'react',
      topicId: 'topic',
      verifiedBy: 'checker',
      citation: { chunkId: 's1' },
    })
    expect(
      rows.flatMap((row) => (row.row === 'chunk' ? [[row.chunkId, row.questions]] : [])),
    ).toEqual([
      ['s1', 3],
      ['s2', 0],
      ['s3', 0],
    ])
    // A chunk that gave nothing to check makes no check call.
    expect(fake.requests.filter((request) => request.model === CHECK)).toHaveLength(1)
  })

  it('reads no chunk again that it has read', async () => {
    const fake = fakeClient()
    const known = generatedChunks([
      { row: 'chunk', chunkId: 's1', textHash: several.chunks[0]?.textHash ?? '', questions: 1 },
    ])
    const { done } = run([several], fake, { known })
    await done

    expect(fake.requests.filter((request) => request.model === GENERATE)).toHaveLength(2)
  })

  it('stops on a reply that did not finish, and keeps nothing of it', async () => {
    const fake = fakeClient(() => ({ stop: 'max_tokens' }))
    const { rows, done } = run([single], fake)

    await expect(done).rejects.toThrow(BankStoppedError)
    expect(rows).toEqual([])
  })

  it('stops before the next call past what the run may spend, keeping what was paid for', async () => {
    const fake = fakeClient()
    const { rows, done } = run([several, single], fake, {
      settings: { ...settings, maxUsd: 0.0005 },
    })

    await expect(done).rejects.toThrow('past the $0.0005 this run may spend')
    expect(rows.some((row) => row.row === 'chunk')).toBe(true)
  })

  it('asks the guard before every paid call', async () => {
    let checks = 0
    const fake = fakeClient()
    const { done } = run([single], fake, {
      guard: {
        check: () => {
          checks++
          return Promise.resolve()
        },
      },
    })
    await done

    expect(checks).toBe(fake.requests.length)
  })
})
