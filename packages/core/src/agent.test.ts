import type Anthropic from '@anthropic-ai/sdk'
import type { EvalAgentSearch } from '@docs-rag-lab/contracts'
import type { SearchHit } from '@docs-rag-lab/db'
import { describe, expect, it } from 'vitest'

import {
  AGENT_SYSTEM_PROMPT,
  buildAgentRequest,
  checkCitations,
  CitationMismatchError,
  runAgentLoop,
  SEARCH_DOCS,
  searchesLeftNote,
  searchInput,
  shownNote,
  type AgentCall,
} from './agent.ts'
import { buildAnswerRequest } from './generate.ts'

const hit = (chunkId: string): SearchHit => ({
  chunkId,
  text: `text of ${chunkId}`,
  context: null,
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

const options = { question: 'Why?', model: 'claude-test', effort: 'low', maxTokens: 100 } as const
const DOC_TYPES = ['handbook', 'reference']

function reply(content: Anthropic.ContentBlock[], stop: Anthropic.StopReason): Anthropic.Message {
  return {
    id: 'm',
    type: 'message',
    role: 'assistant',
    model: 'claude-test',
    content,
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
  } as Anthropic.Message
}

const searchFor = (input: unknown, id = 'toolu_1'): Anthropic.Message =>
  reply([{ type: 'tool_use', id, name: SEARCH_DOCS, input } as Anthropic.ToolUseBlock], 'tool_use')
const answer = reply([{ type: 'text', text: 'The answer.', citations: null }], 'end_turn')

/** A call that replies in turn, and keeps every request with the context it saw. */
function scripted(replies: Anthropic.Message[]) {
  const requests: Anthropic.MessageCreateParamsNonStreaming[] = []
  const contexts: string[][] = []
  const call: AgentCall = (request, step, context) => {
    requests.push(request)
    contexts.push(context.map((h) => h.chunkId))
    const next = replies[step]
    return next === undefined ? Promise.reject(new Error('no reply left')) : Promise.resolve(next)
  }
  return { call, requests, contexts }
}

/** Search results by query, and every search made. */
function searchesOf(results: Record<string, string[]>) {
  const made: { query: string; docTypes: readonly string[] }[] = []
  const search = (query: string, docTypes: readonly string[]) => {
    made.push({ query, docTypes })
    return Promise.resolve((results[query] ?? []).map(hit))
  }
  return { search, made }
}

const first = buildAgentRequest({ ...options, hits: [hit('a'), hit('b')], docTypes: DOC_TYPES })

describe('buildAgentRequest', () => {
  it("sends row 3's search results and question, with the tool, one search a step and caching", () => {
    const single = buildAnswerRequest({ ...options, hits: [hit('a'), hit('b')] })

    expect(first.messages).toEqual(single.messages)
    expect(first.system).toBe(AGENT_SYSTEM_PROMPT)
    expect(first.output_config).toEqual({ effort: 'low' })
    expect(first.cache_control).toEqual({ type: 'ephemeral' })
    expect(first.tool_choice).toEqual({ type: 'auto', disable_parallel_tool_use: true })
    const tool = first.tools?.[0] as Anthropic.Tool
    expect(tool.name).toBe(SEARCH_DOCS)
    expect(tool.strict).toBe(true)
    expect(tool.description).toContain('in English')
    expect(tool.input_schema).toMatchObject({
      required: ['query'],
      additionalProperties: false,
      properties: { docTypes: { items: { enum: DOC_TYPES } } },
    })
  })
})

describe('searchInput', () => {
  it('takes a query and doc types of the index, and says what is wrong otherwise', () => {
    expect(searchInput({ query: ' strict ' }, DOC_TYPES)).toEqual({ query: 'strict', docTypes: [] })
    expect(searchInput({ query: 'x', docTypes: ['reference', 'reference'] }, DOC_TYPES)).toEqual({
      query: 'x',
      docTypes: ['reference'],
    })
    expect(searchInput({ query: '' }, DOC_TYPES)).toBe('query must be a non-empty string')
    expect(searchInput({ query: 'x', docTypes: ['option'] }, DOC_TYPES)).toBe(
      'docTypes must be some of: handbook, reference',
    )
    expect(searchInput(null, DOC_TYPES)).toBe('the input is not an object')
  })
})

describe('searchesLeftNote', () => {
  it('counts what is left, and says when nothing is', () => {
    expect(searchesLeftNote(2)).toBe('You can search 2 more times.')
    expect(searchesLeftNote(1)).toBe('You can search 1 more time.')
    expect(searchesLeftNote(0)).toContain('no search is left')
  })
})

describe('shownNote', () => {
  it('says what a search left out, in the singular too', () => {
    expect(shownNote(0, 0)).toBe('This search found nothing.')
    expect(shownNote(3, 3)).toBe('')
    expect(shownNote(1, 0)).toBe('Its one result is already in this conversation.')
    expect(shownNote(8, 0)).toBe('All 8 of its results are already in this conversation.')
    expect(shownNote(3, 2)).toBe(
      '1 of its results was already in this conversation, and is left out.',
    )
    expect(shownNote(8, 5)).toBe(
      '3 of its results were already in this conversation, and are left out.',
    )
  })
})

describe('checkCitations', () => {
  const citing = (index: number, source: string, title: string | null): Anthropic.Message =>
    reply(
      [
        {
          type: 'text',
          text: 'Cited.',
          citations: [
            {
              type: 'search_result_location',
              cited_text: 'x',
              source,
              title,
              search_result_index: index,
              start_block_index: 0,
              end_block_index: 1,
            },
          ],
        },
      ],
      'end_turn',
    )
  const context = [hit('a'), { ...hit('b'), url: 'https://x.dev/b' }]

  it('passes a citation that names the chunk at its index', () => {
    expect(() => {
      checkCitations(citing(1, 'https://x.dev/b', 'A'), context)
    }).not.toThrow()
  })

  it('refuses one that names another chunk, or points past the conversation', () => {
    expect(() => {
      checkCitations(citing(1, 'https://x.dev/a', 'A'), context)
    }).toThrow(CitationMismatchError)
    expect(() => {
      checkCitations(citing(2, 'https://x.dev/a', null), context)
    }).toThrow('the conversation has 2')
  })
})

describe('runAgentLoop', () => {
  it('ends at once when Claude answers from the first search', async () => {
    const { call, requests } = scripted([answer])
    const { search, made } = searchesOf({})

    const result = await runAgentLoop({
      first,
      hits: [hit('a'), hit('b')],
      docTypes: DOC_TYPES,
      maxSearches: 2,
      call,
      search,
    })

    expect(requests).toEqual([first])
    expect(made).toEqual([])
    expect(result.message).toBe(answer)
    expect(result.failure).toBeUndefined()
    expect(result.context.map((h) => h.chunkId)).toEqual(['a', 'b'])
  })

  it('returns only new chunks, and the next request appends the turn to the same prefix', async () => {
    const asked = searchFor({ query: 'string primitives', docTypes: ['reference'] })
    const { call, requests, contexts } = scripted([asked, answer])
    const { search, made } = searchesOf({ 'string primitives': ['b', 'c', 'd'] })
    const seen: EvalAgentSearch[] = []

    const result = await runAgentLoop({
      first,
      hits: [hit('a'), hit('b')],
      docTypes: DOC_TYPES,
      maxSearches: 2,
      call,
      search,
      onSearch: (record) => seen.push(record),
    })

    expect(made).toEqual([{ query: 'string primitives', docTypes: ['reference'] }])
    const record = {
      query: 'string primitives',
      docTypes: ['reference'],
      chunkIds: ['c', 'd'],
      alreadyShown: 1,
    }
    expect(result.searches).toEqual([record])
    expect(seen).toEqual([record])
    expect(result.context.map((h) => h.chunkId)).toEqual(['a', 'b', 'c', 'd'])
    expect(contexts).toEqual([
      ['a', 'b'],
      ['a', 'b', 'c', 'd'],
    ])

    const second = requests[1]
    expect(second?.messages.slice(0, 1)).toEqual(first.messages)
    expect(second?.system).toBe(first.system)
    expect(second?.tools).toEqual(first.tools)
    expect(second?.tool_choice).toEqual(first.tool_choice)
    expect(second?.cache_control).toEqual(first.cache_control)
    expect(second?.messages[1]).toEqual({ role: 'assistant', content: asked.content })
    // A tool result with search results may hold nothing else (the API refuses it, as the pilot
    // found), so the note follows it in a text block of the same message.
    const [toolResult, note, ...more] = second?.messages[2]?.content as [
      Anthropic.ToolResultBlockParam,
      Anthropic.TextBlockParam,
    ]
    expect(more).toEqual([])
    expect(toolResult.tool_use_id).toBe('toolu_1')
    const content = toolResult.content as { type: string }[]
    expect(content.map((block) => block.type)).toEqual(['search_result', 'search_result'])
    expect(note).toEqual({
      type: 'text',
      text: '1 of its results was already in this conversation, and is left out. You can search 1 more time.',
    })
  })

  it('says when the last search is spent, and gives up on a call after that', async () => {
    const { call, requests } = scripted([
      searchFor({ query: 'one' }, 't1'),
      searchFor({ query: 'two' }, 't2'),
      searchFor({ query: 'three' }, 't3'),
      searchFor({ query: 'four' }, 't4'),
    ])
    const { search, made } = searchesOf({ one: ['c'], two: ['a'] })

    const result = await runAgentLoop({
      first,
      hits: [hit('a'), hit('b')],
      docTypes: DOC_TYPES,
      maxSearches: 2,
      call,
      search,
    })

    expect(made.map(({ query }) => query)).toEqual(['one', 'two'])
    const resultOf = (step: number) =>
      (requests[step]?.messages.at(-1)?.content as Anthropic.ToolResultBlockParam[])[0]
    const second = resultOf(2)?.content as { type: string; text?: string }[]
    expect(second.map((block) => block.type)).toEqual(['text'])
    expect(second[0]?.text).toBe(
      'Its one result is already in this conversation. That was the last search: no search is left. Answer from the results you have.',
    )
    expect(resultOf(3)?.is_error).toBe(true)
    expect(resultOf(3)?.content).toBe('No search is left. Answer from the results you have.')
    expect(requests).toHaveLength(4)
    expect(result.failure).toBe('it asked for a search after it was told none was left')

    // A search with nothing new keeps its note in its tool result, with nothing after it.
    expect(requests[2]?.messages.at(-1)?.content).toHaveLength(1)
    // The search results of the last request, in order, are the loop's list: citations count on it.
    const sent = (requests.at(-1)?.messages ?? []).flatMap((message) =>
      typeof message.content === 'string'
        ? []
        : message.content.flatMap((block) => {
            if (block.type === 'search_result') return [block.content[0]?.text]
            if (block.type !== 'tool_result' || typeof block.content === 'string') return []
            return (block.content ?? []).flatMap((inner) =>
              inner.type === 'search_result' ? [inner.content[0]?.text] : [],
            )
          }),
    )
    expect(sent).toEqual(result.context.map((chunk) => chunk.text))
    expect(sent).toEqual(['text of a', 'text of b', 'text of c'])
  })

  it('never makes more requests than the first, one per search and one after the error', async () => {
    const other = reply(
      [{ type: 'tool_use', id: 't', name: 'other_tool', input: {} } as Anthropic.ToolUseBlock],
      'tool_use',
    )
    const { call, requests } = scripted([other, other, other, other, other])
    const { search } = searchesOf({})

    const result = await runAgentLoop({
      first,
      hits: [hit('a')],
      docTypes: DOC_TYPES,
      maxSearches: 2,
      call,
      search,
    })

    expect(requests).toHaveLength(4)
    expect(result.failure).toBe('it did not stop within the requests allowed')
  })

  it('answers a bad input with an error, which uses up a search', async () => {
    const { call, requests } = scripted([searchFor({ query: '' }), answer])
    const { search, made } = searchesOf({})

    const result = await runAgentLoop({
      first,
      hits: [hit('a')],
      docTypes: DOC_TYPES,
      maxSearches: 1,
      call,
      search,
    })

    expect(made).toEqual([])
    const results = requests[1]?.messages.at(-1)?.content as Anthropic.ToolResultBlockParam[]
    expect(results[0]).toMatchObject({
      is_error: true,
      content:
        'The search did not run: query must be a non-empty string. That was the last search: no search is left. Answer from the results you have.',
    })
    expect(result.failure).toBeUndefined()
    expect(result.searches).toEqual([])
  })
})
