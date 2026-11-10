// Agentic mode (SPEC section 9, ADR-0019). Claude starts from the search results a single-shot
// answer gets, with a search_docs tool, and may search again up to a limit, one search per step.
// Every request asks for automatic prompt caching, so each step reads the prefix the step before
// wrote and writes only what it added. The limit is said in a tool result, never by changing
// tool_choice or dropping the tool: either change would drop the cached conversation.
import { createHash } from 'node:crypto'

import type Anthropic from '@anthropic-ai/sdk'
import type { EvalAgentSearch } from '@docs-rag-lab/contracts'
import type { SearchHit } from '@docs-rag-lab/db'

import {
  buildAnswerRequest,
  citationSource,
  citationTitle,
  toSearchResult,
  type AnswerRequestOptions,
} from './generate.ts'

export const SEARCH_DOCS = 'search_docs'

/** Row 3's rules, and two of its own: search again when the results fall short, and keep quiet about it. */
export const AGENT_SYSTEM_PROMPT = [
  'You answer questions about technical documentation.',
  'Use only the search results in this conversation. Do not rely on outside knowledge.',
  'If the search results do not contain what the question asks, call search_docs with a different query.',
  'If they still do not contain the answer, say so plainly instead of guessing.',
  'Keep the answer short and direct. Include a code example only when the search results contain one that helps.',
  'Do not describe your searches in the answer.',
].join(' ')

/** The tool, with the doc types the source's index holds. The docs are English, which is a fact of the corpus. */
export function searchDocsTool(docTypes: readonly string[]): Anthropic.Tool {
  return {
    name: SEARCH_DOCS,
    description: [
      'Searches the documentation, which is in English, by meaning and by exact words.',
      'Returns up to 8 passages that are not in this conversation yet.',
      'Use a query that differs from the question and from earlier queries.',
      'It can be called a limited number of times, and each result says how many searches are left.',
    ].join(' '),
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to search for.' },
        docTypes: {
          type: 'array',
          items: { type: 'string', enum: [...docTypes] },
          description: 'Only pages of these kinds. Leave it out to search them all.',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
    strict: true,
  }
}

export interface AgentRequestOptions extends AnswerRequestOptions {
  /** The doc types the source's index holds, which search_docs can filter by. */
  docTypes: readonly string[]
}

/**
 * The first request: row 3's search results and question (ADR-0019), with the tool, one search
 * per step, and automatic caching of the whole prefix.
 */
export function buildAgentRequest(
  options: AgentRequestOptions,
): Anthropic.MessageCreateParamsNonStreaming {
  const single = buildAnswerRequest(options)
  return {
    model: single.model,
    max_tokens: single.max_tokens,
    system: AGENT_SYSTEM_PROMPT,
    output_config: single.output_config,
    cache_control: { type: 'ephemeral' },
    tools: [searchDocsTool(options.docTypes)],
    tool_choice: { type: 'auto', disable_parallel_tool_use: true },
    messages: single.messages,
  }
}

/** A search's input, checked, or why it cannot run. The schema is strict, and code checks it anyway. */
export function searchInput(
  input: unknown,
  docTypes: readonly string[],
): { query: string; docTypes: string[] } | string {
  if (typeof input !== 'object' || input === null) return 'the input is not an object'
  const fields = input as Record<string, unknown>
  const query = fields.query
  if (typeof query !== 'string' || query.trim() === '') return 'query must be a non-empty string'
  const asked = fields.docTypes
  if (asked === undefined) return { query: query.trim(), docTypes: [] }
  if (
    !Array.isArray(asked) ||
    !asked.every((type): type is string => typeof type === 'string' && docTypes.includes(type))
  ) {
    return `docTypes must be some of: ${docTypes.join(', ')}`
  }
  return { query: query.trim(), docTypes: [...new Set(asked)] }
}

/** What the end of a tool result says about the searches left. */
export function searchesLeftNote(left: number): string {
  if (left === 0) {
    return 'That was the last search: no search is left. Answer from the results you have.'
  }
  return `You can search ${String(left)} more ${left === 1 ? 'time' : 'times'}.`
}

/** What a search's result says of the results it left out, before the searches left. */
export function shownNote(found: number, fresh: number): string {
  if (found === 0) return 'This search found nothing.'
  const shown = found - fresh
  if (shown === 0) return ''
  if (fresh === 0) {
    return found === 1
      ? 'Its one result is already in this conversation.'
      : `All ${String(found)} of its results are already in this conversation.`
  }
  return shown === 1
    ? '1 of its results was already in this conversation, and is left out.'
    : `${String(shown)} of its results were already in this conversation, and are left out.`
}

/** The error results a step can send. */
export const LOOP_ERRORS = {
  noSearchLeft: 'No search is left. Answer from the results you have.',
  unknownTool: (name: string): string => `There is no tool named ${name}.`,
  didNotRun: (reason: string, left: number): string =>
    `The search did not run: ${reason}. ${searchesLeftNote(left)}`,
}

/**
 * A hash of every text a step can send besides the search results, from samples of each. A stored
 * run of the loop is kept under it, so that rewording one never replays a run made with another.
 */
export function loopTextsHash(): string {
  const samples = [
    ...[0, 1, 2].map(searchesLeftNote),
    ...[
      [0, 0],
      [1, 0],
      [2, 0],
      [2, 1],
      [3, 2],
      [8, 8],
    ].map(([found = 0, fresh = 0]) => shownNote(found, fresh)),
    LOOP_ERRORS.noSearchLeft,
    LOOP_ERRORS.unknownTool('x'),
    LOOP_ERRORS.didNotRun('x', 1),
  ]
  return createHash('sha256').update(JSON.stringify(samples)).digest('hex').slice(0, 16)
}

/** Thrown when a citation does not name the chunk the loop's list puts at its index. */
export class CitationMismatchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CitationMismatchError'
  }
}

/**
 * Checks that each search-result citation of a message names the chunk the loop's list puts at its
 * index, by the source and title that chunk was sent with. ADR-0019 takes the API's numbering to
 * run across the whole request; a numbering that did not would map citations to other chunks with
 * no error, so this says so instead.
 */
export function checkCitations(message: Anthropic.Message, context: readonly SearchHit[]): void {
  for (const block of message.content) {
    if (block.type !== 'text') continue
    for (const citation of block.citations ?? []) {
      if (citation.type !== 'search_result_location') continue
      const index = citation.search_result_index
      const hit = context[index]
      if (hit === undefined) {
        throw new CitationMismatchError(
          `a citation points to search result ${String(index)}, and the conversation has ${String(context.length)}`,
        )
      }
      const title = citation.title
      if (
        citation.source !== citationSource(hit) ||
        (title !== null && title !== citationTitle(hit))
      ) {
        throw new CitationMismatchError(
          `search result ${String(index)} is cited as ${citation.source}, and the loop sent ${citationSource(hit)} there`,
        )
      }
    }
  }
}

/** Sends one request of the loop and returns Claude's message. `context` is every chunk so far. */
export type AgentCall = (
  request: Anthropic.MessageCreateParamsNonStreaming,
  step: number,
  context: readonly SearchHit[],
) => Promise<Anthropic.Message>

/** A search of Claude's own: the strategy's top results for the query, in rank order. */
export type AgentSearchFn = (
  query: string,
  docTypes: readonly string[],
) => Promise<readonly SearchHit[]>

export interface AgentLoopOptions {
  /** From buildAgentRequest. */
  first: Anthropic.MessageCreateParamsNonStreaming
  /** The search results the first request holds, in order. */
  hits: readonly SearchHit[]
  /** The doc types the tool offers, for checking its input. */
  docTypes: readonly string[]
  maxSearches: number
  call: AgentCall
  search: AgentSearchFn
  /** Before each search of Claude's own, with what it asked for. */
  onSearchStart?: (query: string, docTypes: readonly string[]) => void
  /** After each search of Claude's own, with what it returned. */
  onSearch?: (search: EvalAgentSearch, hits: readonly SearchHit[]) => void
  /** Stops the loop before its next request or search, as when a person presses Stop. */
  signal?: AbortSignal | undefined
}

export interface AgentLoopResult {
  /** The last message: the answer, unless the loop failed. */
  message: Anthropic.Message
  /** Every message, one per request, in order. */
  messages: Anthropic.Message[]
  /** Every chunk of the conversation, in the order the API numbers search results. */
  context: SearchHit[]
  searches: EvalAgentSearch[]
  /** Why the loop gave up, when it did. */
  failure?: string
}

const errorResult = (id: string, text: string): Anthropic.ToolResultBlockParam => ({
  type: 'tool_result',
  tool_use_id: id,
  content: text,
  is_error: true,
})

/**
 * Runs the loop until Claude stops asking for searches (ADR-0019). Each search returns the
 * strategy's top results less the chunks the conversation already holds. After the last search
 * allowed, a further call gets an error result, and a message that still asks for one ends the
 * loop as failed. So does one that asks for a tool on the last request allowed, the first, one
 * per search and one after the error: whatever it calls, the loop never makes more.
 */
export async function runAgentLoop(options: AgentLoopOptions): Promise<AgentLoopResult> {
  const { maxSearches, call, search, docTypes } = options
  const context = [...options.hits]
  const seen = new Set(context.map((hit) => hit.chunkId))
  const searches: EvalAgentSearch[] = []
  const messages: Anthropic.Message[] = []
  let request = options.first
  let used = 0
  // Set once a call past the limit got its error result: the next message has to answer.
  let refusedOnce = false
  for (;;) {
    options.signal?.throwIfAborted()
    const message = await call(request, messages.length, context)
    messages.push(message)
    const result = { message, messages, context, searches }
    if (message.stop_reason !== 'tool_use') return result
    if (refusedOnce) {
      return { ...result, failure: 'it asked for a search after it was told none was left' }
    }
    if (messages.length >= maxSearches + 2) {
      return { ...result, failure: 'it did not stop within the requests allowed' }
    }
    const uses = message.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
    )
    if (uses.length === 0) return { ...result, failure: 'it stopped for a tool and called none' }
    const results: Anthropic.ToolResultBlockParam[] = []
    // A tool result with search results may hold nothing else, so what a search says of itself
    // goes after the tool results, in a text block of the same message.
    const notes: string[] = []
    for (const use of uses) {
      if (use.name !== SEARCH_DOCS) {
        results.push(errorResult(use.id, LOOP_ERRORS.unknownTool(use.name)))
        continue
      }
      if (used >= maxSearches) {
        refusedOnce = true
        results.push(errorResult(use.id, LOOP_ERRORS.noSearchLeft))
        continue
      }
      used++
      const left = maxSearches - used
      const input = searchInput(use.input, docTypes)
      if (typeof input === 'string') {
        results.push(errorResult(use.id, LOOP_ERRORS.didNotRun(input, left)))
        continue
      }
      options.signal?.throwIfAborted()
      options.onSearchStart?.(input.query, input.docTypes)
      const found = await search(input.query, input.docTypes)
      options.signal?.throwIfAborted()
      const fresh = found.filter((hit) => !seen.has(hit.chunkId))
      for (const hit of fresh) {
        seen.add(hit.chunkId)
        context.push(hit)
      }
      const record: EvalAgentSearch = {
        query: input.query,
        docTypes: input.docTypes,
        chunkIds: fresh.map((hit) => hit.chunkId),
        alreadyShown: found.length - fresh.length,
      }
      searches.push(record)
      options.onSearch?.(record, fresh)
      const note = [shownNote(found.length, fresh.length), searchesLeftNote(left)]
        .filter(Boolean)
        .join(' ')
      if (fresh.length === 0) {
        results.push({
          type: 'tool_result',
          tool_use_id: use.id,
          content: [{ type: 'text', text: note }],
        })
      } else {
        results.push({
          type: 'tool_result',
          tool_use_id: use.id,
          content: fresh.map(toSearchResult),
        })
        notes.push(note)
      }
    }
    request = {
      ...request,
      messages: [
        ...request.messages,
        { role: 'assistant', content: message.content },
        {
          role: 'user',
          content: [
            ...results,
            ...notes.map((text): Anthropic.TextBlockParam => ({ type: 'text', text })),
          ],
        },
      ],
    }
  }
}
