// Agentic mode (SPEC section 9, ADR-0019). Claude starts from the search results a single-shot
// answer gets, with a search_docs tool, and may search again up to a limit, one search per step.
// Every request asks for automatic prompt caching, so each step reads the prefix the step before
// wrote and writes only what it added. The limit is said in a tool result, never by changing
// tool_choice or dropping the tool: either change would drop the cached conversation.
import type Anthropic from '@anthropic-ai/sdk'
import type { EvalAgentSearch } from '@docs-rag-lab/contracts'
import type { SearchHit } from '@docs-rag-lab/db'

import { buildAnswerRequest, toSearchResult, type AnswerRequestOptions } from './generate.ts'

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
  /** After each search of Claude's own, with what it returned. */
  onSearch?: (search: EvalAgentSearch, hits: readonly SearchHit[]) => void
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
 * loop as failed.
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
    const message = await call(request, messages.length, context)
    messages.push(message)
    const result = { message, messages, context, searches }
    if (message.stop_reason !== 'tool_use') return result
    if (refusedOnce) {
      return { ...result, failure: 'it asked for a search after it was told none was left' }
    }
    const uses = message.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
    )
    if (uses.length === 0) return { ...result, failure: 'it stopped for a tool and called none' }
    const results: Anthropic.ToolResultBlockParam[] = []
    for (const use of uses) {
      if (use.name !== SEARCH_DOCS) {
        results.push(errorResult(use.id, `There is no tool named ${use.name}.`))
        continue
      }
      if (used >= maxSearches) {
        refusedOnce = true
        results.push(errorResult(use.id, 'No search is left. Answer from the results you have.'))
        continue
      }
      used++
      const left = maxSearches - used
      const input = searchInput(use.input, docTypes)
      if (typeof input === 'string') {
        results.push(
          errorResult(use.id, `The search did not run: ${input}. ${searchesLeftNote(left)}`),
        )
        continue
      }
      const found = await search(input.query, input.docTypes)
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
      const shown =
        found.length === 0
          ? 'This search found nothing.'
          : fresh.length === 0
            ? `All ${String(found.length)} of its results are already in this conversation.`
            : record.alreadyShown === 0
              ? ''
              : `${String(record.alreadyShown)} of its results already in this conversation were left out.`
      results.push({
        type: 'tool_result',
        tool_use_id: use.id,
        content: [
          ...fresh.map(toSearchResult),
          { type: 'text', text: [shown, searchesLeftNote(left)].filter(Boolean).join(' ') },
        ],
      })
    }
    request = {
      ...request,
      messages: [
        ...request.messages,
        { role: 'assistant', content: message.content },
        { role: 'user', content: results },
      ],
    }
  }
}
