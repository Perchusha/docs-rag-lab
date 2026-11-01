import type { AnswerEvent, RetrievalRequest, RetrievalTrace } from '@docs-rag-lab/contracts'
import { UsageMeter, type Engine } from '@docs-rag-lab/core'
import { settings } from '@docs-rag-lab/settings'
import { describe, expect, it } from 'vitest'

import { askCommand, searchCommand, type CommandContext } from './commands.ts'

const trace: RetrievalTrace = {
  version: 2,
  question: 'q',
  sourceId: 'typescript',
  strategy: 'vector',
  params: { topK: 1, candidates: 50, rrfK: 60 },
  filters: { docTypes: [] },
  query: { terms: [], exactTokens: [] },
  embedding: { provider: 'voyage:voyage-4:1024', from: 'cache', ms: 0 },
  lists: [{ name: 'vector', scoring: 'cosine-distance', ms: 0, candidates: [] }],
  fusion: { method: 'none' },
  chunks: {},
  context: [],
  totalMs: 1,
}

const usage = { models: [], costUsd: 0, pricesChecked: '2026-10-31', unpriced: [] }

const citation = {
  number: 1,
  source: 'https://x.dev/a#b',
  title: 'A > B',
  citedText: 'Quoted.',
  chunkId: 'c1',
  contextRank: 1,
}

/** An engine that replays events and records the requests it got. */
function fakeEngine(events: AnswerEvent[]) {
  const requests: RetrievalRequest[] = []
  const engine: Engine = {
    sources: [],
    search: (request) => {
      requests.push(request)
      return Promise.resolve({ hits: [], trace })
    },
    ask: (request, run) => {
      requests.push(request)
      for (const event of events) run.onEvent(event)
      return Promise.resolve({ hits: [], trace })
    },
    documentChunks: () => undefined,
  }
  return { engine, requests }
}

function context(engine: Engine) {
  let text = ''
  const ctx: CommandContext = {
    settings,
    sources: [],
    engine,
    root: '.',
    meter: new UsageMeter(),
    out: { write: (chunk: string) => (text += chunk) },
    now: () => 0,
  }
  return { ctx, text: () => text }
}

const args = {
  question: 'What is a union type?',
  source: 'typescript',
  topK: 3,
  strategy: 'hybrid' as const,
  docTypes: ['handbook' as const],
}

describe('askCommand', () => {
  it('prints the streamed answer, the markers after each cited block, and the sources', async () => {
    const { engine, requests } = fakeEngine([
      { type: 'trace', trace },
      { type: 'text', text: 'A union type ' },
      { type: 'text', text: 'is one of several types.' },
      { type: 'citations', numbers: [1], citations: [citation] },
      { type: 'done', stopReason: 'end_turn', usage },
    ])
    const { ctx, text } = context(engine)

    await askCommand(ctx, { ...args, verbose: false })

    expect(text()).toBe(
      'A union type is one of several types.[1]\n\n' +
        'Sources:\n[1] A > B\n    https://x.dev/a#b\n    "Quoted."\n',
    )
    expect(requests).toEqual([
      {
        question: 'What is a union type?',
        source: 'typescript',
        strategy: 'hybrid',
        topK: 3,
        docTypes: ['handbook'],
      },
    ])
  })

  it('prints the trace first with --verbose, and notes a cut-off answer', async () => {
    const { engine } = fakeEngine([
      { type: 'trace', trace },
      { type: 'text', text: 'Partial' },
      { type: 'done', stopReason: 'max_tokens', usage },
    ])
    const { ctx, text } = context(engine)

    await askCommand(ctx, { ...args, verbose: true })

    expect(text()).toMatch(/^retrieval: vector over typescript, top 1\n/)
    expect(text()).toContain(
      'Partial\n\n(The answer hit max_tokens and is cut off.)\n\nSources: none cited.\n',
    )
  })

  it('says so when nothing was retrieved to answer from', async () => {
    const { engine } = fakeEngine([
      { type: 'trace', trace },
      { type: 'done', stopReason: 'no_context', usage },
    ])
    const { ctx, text } = context(engine)

    await askCommand(ctx, { ...args, verbose: false })

    expect(text()).toBe('No indexed chunks to answer from.\n')
  })
})

describe('searchCommand', () => {
  it('prints the trace from the engine as JSON', async () => {
    const { engine } = fakeEngine([])
    const { ctx, text } = context(engine)

    await searchCommand(ctx, { ...args, json: true })

    expect(JSON.parse(text())).toEqual(trace)
  })
})
