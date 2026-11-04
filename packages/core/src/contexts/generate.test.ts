import type Anthropic from '@anthropic-ai/sdk'
import type { ContextualizeSettings, PricingSettings } from '@docs-rag-lab/settings'
import { describe, expect, it } from 'vitest'

import type { AnswerClient } from '../generate.ts'
import { UsageMeter } from '../usage.ts'
import {
  contextIdentity,
  contextPromptHash,
  ContextsStoppedError,
  forecastContexts,
  generateContexts,
  pilotChunks,
  planContexts,
  type ContextDocument,
} from './generate.ts'
import type { StoredContext } from './store.ts'
import { contextualText } from './text.ts'

const MODEL = 'claude-small'

const settings: ContextualizeSettings = {
  effort: 'low',
  maxTokens: 300,
  concurrency: 2,
  minCacheableTokens: 100,
  maxUsd: 1,
}

const pricing: PricingSettings = {
  checked: '2026-11-04',
  sources: [],
  models: { [MODEL]: { input: 1, output: 5, cacheWrite5m: 1.25, cacheRead: 0.1 } },
}

const chunk = (id: string, size = 40) => ({
  id,
  text: `Text of ${id}. ${'word '.repeat(size)}`,
  textHash: `hash of ${id}`,
  sectionPath: [],
})

const single: ContextDocument = { path: 'a-single.md', title: 'S', chunks: [chunk('s1')] }
const several: ContextDocument = {
  path: 'b-several.md',
  title: 'M',
  chunks: [chunk('m1'), chunk('m2'), chunk('m3'), chunk('m4')],
}

const stored = (id: string, textHash = `hash of ${id}`): StoredContext => ({
  chunkId: id,
  textHash,
  context: `Stored context of ${id}.`,
})

type Reply = Partial<Pick<Anthropic.Message, 'stop_reason'>> & { text?: string }

/** A Claude client that records what it was asked, and what was running when it was asked. */
function fakeClient(reply: (chunkText: string) => Reply = () => ({})) {
  const requests: Anthropic.MessageCreateParamsNonStreaming[] = []
  const finishedAtStart: number[] = []
  let finished = 0
  let running = 0
  let mostRunning = 0
  const chunkTextOf = (request: Anthropic.MessageCreateParamsNonStreaming): string => {
    const content = request.messages[0]?.content
    const block = Array.isArray(content) ? content[1] : undefined
    return block?.type === 'text' ? block.text : ''
  }
  const client: AnswerClient = {
    messages: {
      stream(request) {
        requests.push(request)
        finishedAtStart.push(finished)
        running++
        mostRunning = Math.max(mostRunning, running)
        return {
          on: () => undefined,
          currentMessage: undefined,
          finalMessage: async () => {
            await new Promise((resolve) => setTimeout(resolve, 1))
            running--
            finished++
            const { text = 'A context.', stop_reason: stopReason = 'end_turn' } = reply(
              chunkTextOf(request),
            )
            return {
              stop_reason: stopReason,
              content: [{ type: 'text', text, citations: null }],
              usage: { input_tokens: 10, output_tokens: 20 },
            } as Anthropic.Message
          },
        }
      },
    },
  }
  return {
    client,
    requests,
    finishedAtStart,
    mostRunning: () => mostRunning,
    chunkTextOf,
  }
}

function run(
  documents: readonly ContextDocument[],
  fake: ReturnType<typeof fakeClient>,
  overrides: Partial<Parameters<typeof generateContexts>[1]> = {},
) {
  const written: StoredContext[] = []
  const options = {
    client: fake.client,
    model: MODEL,
    settings,
    pricing,
    meter: new UsageMeter(),
    known: new Map<string, StoredContext>(),
    onContext: (context: StoredContext) => written.push(context),
    ...overrides,
  }
  return { written, options, done: generateContexts(documents, options) }
}

describe('contextualText', () => {
  it('puts the context before the chunk, and leaves a chunk with none as it is', () => {
    expect(contextualText('About unions.', 'A > B\n\nText.')).toBe(
      'About unions.\n\nA > B\n\nText.',
    )
    expect(contextualText(null, 'A > B\n\nText.')).toBe('A > B\n\nText.')
  })
})

describe('contextPromptHash', () => {
  it('is stable, and changes with what decides a context', () => {
    const hash = contextPromptHash(settings)
    expect(hash).toMatch(/^[0-9a-f]{12}$/)
    expect(contextPromptHash({ ...settings })).toBe(hash)
    expect(contextPromptHash({ ...settings, effort: 'high' })).not.toBe(hash)
    expect(contextPromptHash({ ...settings, maxTokens: 100 })).not.toBe(hash)
  })

  it('ignores how a run is paced and capped, which change no context', () => {
    const paced: ContextualizeSettings = { ...settings, concurrency: 9, maxUsd: 9 }
    expect(contextPromptHash(paced)).toBe(contextPromptHash(settings))
  })

  it('names the model and the hash for a manifest', () => {
    expect(contextIdentity(MODEL, settings)).toBe(`${MODEL}:${contextPromptHash(settings)}`)
  })
})

describe('generateContexts', () => {
  it('sends the whole document and the chunk, with thinking off, as the write-up asks', async () => {
    const fake = fakeClient()
    await run([several], fake).done
    const [request] = fake.requests
    expect(request).toMatchObject({
      model: MODEL,
      max_tokens: 300,
      thinking: { type: 'disabled' },
      output_config: { effort: 'low' },
    })
    const content = request?.messages[0]?.content as Anthropic.TextBlockParam[]
    expect(content[0]?.text).toBe(
      `<document>\n${several.chunks.map((c) => c.text).join('\n\n')}\n</document>`,
    )
    expect(content[1]?.text).toContain(`<chunk>\n${several.chunks[0]?.text ?? ''}\n</chunk>`)
    expect(content[1]?.text).toContain(
      'Please give a short succinct context to situate this chunk within the overall document',
    )
  })

  it('caches the same document block for every chunk of a document', async () => {
    const fake = fakeClient()
    await run([several], fake).done
    const blocks = fake.requests.map(
      (request) => (request.messages[0]?.content as Anthropic.TextBlockParam[])[0],
    )
    expect(blocks).toHaveLength(4)
    expect(new Set(blocks.map((block) => JSON.stringify(block))).size).toBe(1)
    expect(blocks[0]?.cache_control).toEqual({ type: 'ephemeral' })
  })

  it('pays no cache write for a document with one chunk to write', async () => {
    const fake = fakeClient()
    await run([single], fake).done
    const content = fake.requests[0]?.messages[0]?.content as Anthropic.TextBlockParam[]
    expect(content[0]).not.toHaveProperty('cache_control')
  })

  it('finishes the first request of a document before the others start', async () => {
    const fake = fakeClient()
    await run([several], fake).done
    expect(fake.finishedAtStart[0]).toBe(0)
    expect(fake.finishedAtStart[1]).toBe(1)
    expect(fake.finishedAtStart[2]).toBe(1)
  })

  it('holds to the concurrency in settings, and gets every chunk its context', async () => {
    const fake = fakeClient()
    const { written, done } = run([single, several], fake)
    await done
    expect(fake.mostRunning()).toBe(2)
    expect(written.map(({ chunkId }) => chunkId).sort()).toEqual(['m1', 'm2', 'm3', 'm4', 's1'])
    expect(written[0]).toEqual({
      chunkId: 's1',
      textHash: 'hash of s1',
      context: 'A context.',
    })
  })

  it('calls nothing for a chunk the file already holds, and again for one whose text changed', async () => {
    const fake = fakeClient()
    const known = new Map([
      ['m1', stored('m1')],
      ['m2', stored('m2')],
      ['m3', stored('m3', 'an older text')],
    ])
    const { written, done } = run([several], fake, { known })
    await done
    expect(written.map(({ chunkId }) => chunkId).sort()).toEqual(['m3', 'm4'])
  })

  it('writes only the chunks asked for, against the whole document', async () => {
    const fake = fakeClient()
    const { written, done } = run([several], fake, { only: new Set(['m2']) })
    await done
    expect(written.map(({ chunkId }) => chunkId)).toEqual(['m2'])
    const content = fake.requests[0]?.messages[0]?.content as Anthropic.TextBlockParam[]
    expect(content[0]?.text).toContain('Text of m4.')
  })

  it('records what each call used', async () => {
    const fake = fakeClient()
    const meter = new UsageMeter()
    await run([several], fake, { meter }).done
    expect(meter.entries()).toEqual([
      [MODEL, expect.objectContaining({ requests: 4, inputTokens: 40, outputTokens: 80 })],
    ])
  })

  it('turns an em dash into a hyphen, since these lines are committed', async () => {
    const dash = String.fromCharCode(0x2014)
    const fake = fakeClient(() => ({ text: `  One ${dash} and ${dash} two.\n` }))
    const { written, done } = run([single], fake)
    await done
    expect(written[0]?.context).toBe('One - and - two.')
  })

  it.each<[string, Reply, RegExp]>([
    ['cut off', { stop_reason: 'max_tokens' }, /s1 in a-single\.md stopped with max_tokens/],
    ['refused', { stop_reason: 'refusal' }, /s1 in a-single\.md stopped with refusal/],
    ['empty', { text: '  ' }, /s1 in a-single\.md is empty/],
  ])('keeps no context that came back %s, and stops', async (_, reply, message) => {
    const fake = fakeClient(() => reply)
    const { written, done } = run([single], fake)
    await expect(done).rejects.toThrow(ContextsStoppedError)
    await expect(done).rejects.toThrow(message)
    expect(written).toEqual([])
  })

  it('makes no call once the run moved', async () => {
    const fake = fakeClient()
    const guard = { check: () => Promise.reject(new Error('the repository moved')) }

    const { written, done } = run([several], fake, { guard })

    await expect(done).rejects.toThrow('the repository moved')
    expect(written).toEqual([])
    expect(fake.requests).toEqual([])
  })

  it('stops before the next call past what settings allow, and keeps what it got', async () => {
    const fake = fakeClient()
    // 10 tokens in and 20 out cost $0.00011 a call at these prices.
    const { written, done } = run([single, several], fake, {
      settings: { ...settings, maxUsd: 0.0001 },
    })
    await expect(done).rejects.toThrow(/past the \$0\.0001 this run may spend, with 1 of 5/)
    expect(written).toHaveLength(1)
    expect(fake.requests).toHaveLength(1)
  })
})

describe('planContexts', () => {
  const options = { model: MODEL, settings, pricing, known: new Map<string, StoredContext>() }

  it('counts one cache write and the rest as reads for a document with several chunks', () => {
    const plan = planContexts([several], options)
    expect(plan.toGenerate).toBe(4)
    expect(plan.documents).toBe(1)
    expect(plan.tokens.cacheWrite).toBeGreaterThan(0)
    expect(plan.tokens.cacheRead).toBe(plan.tokens.cacheWrite * 3)
    expect(plan.tokens.output).toBe(400)
  })

  it('counts no caching for one chunk, or for a document below the model minimum', () => {
    expect(planContexts([single], options).tokens).toMatchObject({ cacheWrite: 0, cacheRead: 0 })
    const small: ContextDocument = {
      path: 'c.md',
      title: 'C',
      chunks: [chunk('c1', 1), chunk('c2', 1)],
    }
    expect(planContexts([small], options).tokens).toMatchObject({ cacheWrite: 0, cacheRead: 0 })
  })

  it('prices them at the prices in settings, cheaper than sending each document whole', () => {
    const plan = planContexts([several], options)
    const { uncached, cacheWrite, cacheRead, output } = plan.tokens
    expect(plan.inputUsd).toBeCloseTo((uncached + cacheWrite * 1.25 + cacheRead * 0.1) / 1e6, 9)
    expect(plan.outputUsd).toBeCloseTo((output * 5) / 1e6, 9)
    expect(plan.inputUsd).toBeLessThan((uncached + cacheWrite + cacheRead) / 1e6)
  })

  it('plans nothing for what the file holds', () => {
    const known = new Map(several.chunks.map(({ id }) => [id, stored(id)]))
    expect(planContexts([several], { ...options, known })).toMatchObject({
      toGenerate: 0,
      documents: 0,
      inputUsd: 0,
      outputUsd: 0,
    })
  })

  it('refuses a model with no price, rather than calling it free', () => {
    expect(() => planContexts([several], { ...options, model: 'unknown' })).toThrow(
      'settings hold no price for unknown',
    )
  })
})

describe('forecastContexts', () => {
  it('scales the whole plan by what the pilot measured against its own', () => {
    const options = { model: MODEL, settings, pricing, known: new Map<string, StoredContext>() }
    const whole = planContexts([single, several], options)
    const pilot = planContexts([several], options)
    const used = {
      inputTokens: pilot.tokens.uncached * 2,
      cacheWriteTokens: pilot.tokens.cacheWrite * 2,
      cacheReadTokens: pilot.tokens.cacheRead * 2,
      outputTokens: 40 * pilot.toGenerate,
    }
    const forecast = forecastContexts(whole, pilot, used, MODEL, pricing)
    expect(forecast.inputAgainstPlan).toBeCloseTo(2, 9)
    expect(forecast.outputTokensPerContext).toBe(40)
    expect(forecast.usd).toBeCloseTo(whole.inputUsd * 2 + (5 * 40 * 5) / 1e6, 9)
  })
})

describe('pilotChunks', () => {
  it('picks from documents with several chunks, so that the pilot shows prompt caching', () => {
    expect([...pilotChunks([single, several], new Map(), 3)]).toEqual(['m1', 'm2', 'm3'])
  })

  it('takes at most five from a document, to see more than one', () => {
    const big: ContextDocument = {
      path: 'b.md',
      title: 'B',
      chunks: ['1', '2', '3', '4', '5', '6', '7'].map((n) => chunk(`b${n}`)),
    }
    const other: ContextDocument = {
      path: 'c.md',
      title: 'C',
      chunks: [chunk('c1'), chunk('c2')],
    }
    expect([...pilotChunks([other, big], new Map(), 7)]).toEqual([
      'b1',
      'b2',
      'b3',
      'b4',
      'b5',
      'c1',
      'c2',
    ])
  })

  it('skips what the file holds, so that a second pilot pays for other chunks', () => {
    const known = new Map([['m1', stored('m1')]])
    expect([...pilotChunks([several], known, 2)]).toEqual(['m2', 'm3'])
  })
})
