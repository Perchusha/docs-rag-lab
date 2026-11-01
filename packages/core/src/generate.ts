// Answers with native citations (SPEC section 9): each retrieved chunk is a
// search_result block whose source is the doc URL with the section anchor,
// and whose content is one text block per rendered block, so Claude can cite
// precise passages.
import Anthropic from '@anthropic-ai/sdk'
import type { Citation } from '@docs-rag-lab/contracts'
import type { SearchHit } from '@docs-rag-lab/db'
import type { Effort } from '@docs-rag-lab/settings'

import { requireKey } from './env.ts'

export const ANSWER_SYSTEM_PROMPT = [
  'You answer questions about technical documentation.',
  "Use only the search results in the user's message. Do not rely on outside knowledge.",
  'If the search results do not contain the answer, say so plainly instead of guessing.',
  'Keep the answer short and direct. Include a code example only when the search results contain one that helps.',
].join(' ')

/** The citation source: the canonical doc URL, plus the section anchor when it has one. */
export function citationSource(hit: Pick<SearchHit, 'url' | 'anchor'>): string {
  return hit.anchor === '' || hit.url.includes('#') ? hit.url : `${hit.url}#${hit.anchor}`
}

/**
 * The heading path of the section a chunk starts in, which its anchor points to
 * (metadata.sectionPath, chunker version 3). A pack of sections under the
 * document root has an empty heading path, so without this it would be cited
 * by the document title alone. Falls back to the heading path for older chunks.
 */
export function sectionPathOf(hit: Pick<SearchHit, 'headingPath' | 'metadata'>): string[] {
  const path = hit.metadata.sectionPath
  return Array.isArray(path) && path.every((part) => typeof part === 'string')
    ? path
    : hit.headingPath
}

/** The citation title: doc title, then the section the chunk starts in. */
export function citationTitle(hit: Pick<SearchHit, 'title' | 'headingPath' | 'metadata'>): string {
  return [hit.title, ...sectionPathOf(hit)].join(' > ')
}

function spansOf(hit: SearchHit): [number, number][] {
  const spans = hit.metadata.spans
  if (
    Array.isArray(spans) &&
    spans.every(
      (span): span is [number, number] =>
        Array.isArray(span) &&
        span.length === 2 &&
        typeof span[0] === 'number' &&
        typeof span[1] === 'number',
    )
  ) {
    return spans
  }
  // Without spans, everything after the heading-path prefix line is one block.
  const start = hit.text.indexOf('\n\n')
  return [[start === -1 ? 0 : start + 2, hit.text.length]]
}

/** One search_result block per retrieved chunk, with citations enabled. */
export function toSearchResult(hit: SearchHit): Anthropic.SearchResultBlockParam {
  const content = spansOf(hit)
    .map(([start, end]) => hit.text.slice(start, end).trim())
    .filter((text) => text !== '')
    .map((text): Anthropic.TextBlockParam => ({ type: 'text', text }))
  return {
    type: 'search_result',
    source: citationSource(hit),
    title: citationTitle(hit),
    content: content.length > 0 ? content : [{ type: 'text', text: hit.text }],
    citations: { enabled: true },
  }
}

export interface AnswerRequestOptions {
  question: string
  hits: readonly SearchHit[]
  model: string
  effort: Effort
  maxTokens: number
}

export function buildAnswerRequest(
  options: AnswerRequestOptions,
): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: options.model,
    max_tokens: options.maxTokens,
    system: ANSWER_SYSTEM_PROMPT,
    output_config: { effort: options.effort },
    messages: [
      {
        role: 'user',
        content: [...options.hits.map(toSearchResult), { type: 'text', text: options.question }],
      },
    ],
  }
}

/** The Claude client. It reads ANTHROPIC_API_KEY from the environment here, so settings never carry the key. */
export function createClaudeClient(env: NodeJS.ProcessEnv = process.env): Anthropic {
  return new Anthropic({ apiKey: requireKey('ANTHROPIC_API_KEY', env) })
}

export interface StreamHandlers {
  onText?: (delta: string) => void
  /** Called when a text block is complete, with its citations (possibly none). */
  onTextBlock?: (block: Anthropic.TextBlock) => void
  /**
   * Called once with the usage so far, also when the stream fails part-way,
   * so the tokens of a broken answer are still reported.
   */
  onUsage?: (usage: Anthropic.Usage) => void
}

/** The part of a message stream that streamAnswer uses; tests pass a fake. */
export interface AnswerStream {
  on(event: 'text', listener: (delta: string) => void): unknown
  on(event: 'contentBlock', listener: (block: Anthropic.ContentBlock) => void): unknown
  finalMessage(): Promise<Anthropic.Message>
  readonly currentMessage: Anthropic.Message | undefined
}

/** The part of the Claude client that streamAnswer uses; tests pass a fake. */
export interface AnswerClient {
  messages: {
    stream(
      request: Anthropic.MessageCreateParamsNonStreaming,
      options?: { signal?: AbortSignal },
    ): AnswerStream
  }
}

/**
 * Streams the answer and resolves with the final message. An aborted `signal`
 * stops the request, so a closed browser tab stops spending tokens.
 */
export async function streamAnswer(
  client: AnswerClient,
  request: Anthropic.MessageCreateParamsNonStreaming,
  handlers: StreamHandlers = {},
  signal?: AbortSignal,
): Promise<Anthropic.Message> {
  const stream = client.messages.stream(request, signal === undefined ? undefined : { signal })
  stream.on('text', (delta) => handlers.onText?.(delta))
  stream.on('contentBlock', (block) => {
    if (block.type === 'text') handlers.onTextBlock?.(block)
  })
  let message: Anthropic.Message | undefined
  try {
    message = await stream.finalMessage()
    return message
  } finally {
    const usage = (message ?? stream.currentMessage)?.usage
    if (usage !== undefined) handlers.onUsage?.(usage)
  }
}

/**
 * Numbers search-result citations in order of first use, one number per
 * search result, so the answer can show [1], [2] and a source list. Each
 * number also names the context chunk it points to: search result i is
 * context[i], in the order buildAnswerRequest sent them.
 */
export class CitationNumbering {
  readonly #byIndex = new Map<number, Citation>()
  readonly #context: readonly Pick<SearchHit, 'chunkId'>[]

  constructor(context: readonly Pick<SearchHit, 'chunkId'>[]) {
    this.#context = context
  }

  /** The numbers for a text block's search-result citations, deduplicated, in order. */
  add(block: Anthropic.TextBlock): number[] {
    const numbers: number[] = []
    for (const citation of block.citations ?? []) {
      if (citation.type !== 'search_result_location') continue
      let entry = this.#byIndex.get(citation.search_result_index)
      if (entry === undefined) {
        const index = citation.search_result_index
        const chunk = this.#context[index]
        if (chunk === undefined) {
          throw new Error(
            `a citation points to search result ${String(index)}, but the context has ${String(this.#context.length)}`,
          )
        }
        entry = {
          number: this.#byIndex.size + 1,
          source: citation.source,
          title: citation.title ?? citation.source,
          citedText: citation.cited_text,
          chunkId: chunk.chunkId,
          contextRank: index + 1,
        }
        this.#byIndex.set(citation.search_result_index, entry)
      }
      if (!numbers.includes(entry.number)) numbers.push(entry.number)
    }
    return numbers
  }

  list(): Citation[] {
    return [...this.#byIndex.values()].sort((a, b) => a.number - b.number)
  }
}
