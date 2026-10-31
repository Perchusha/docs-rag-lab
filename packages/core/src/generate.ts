// Answers with native citations (SPEC section 9): each retrieved chunk is a
// search_result block whose source is the doc URL with the section anchor,
// and whose content is one text block per rendered block, so Claude can cite
// precise passages.
import Anthropic from '@anthropic-ai/sdk'
import type { SearchHit } from '@docs-rag-lab/db'

import type { Effort } from './config.ts'

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

/** The citation title: doc title and heading path. */
export function citationTitle(hit: Pick<SearchHit, 'title' | 'headingPath'>): string {
  return [hit.title, ...hit.headingPath].join(' > ')
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

export function createClaudeClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey })
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

/** Streams the answer and resolves with the final message. */
export async function streamAnswer(
  client: {
    messages: { stream(request: Anthropic.MessageCreateParamsNonStreaming): AnswerStream }
  },
  request: Anthropic.MessageCreateParamsNonStreaming,
  handlers: StreamHandlers = {},
): Promise<Anthropic.Message> {
  const stream = client.messages.stream(request)
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

export interface NumberedCitation {
  number: number
  source: string
  title: string
  citedText: string
}

/**
 * Numbers search-result citations in order of first use, one number per
 * search result, so the answer can show [1], [2] and a source list.
 */
export class CitationNumbering {
  readonly #byIndex = new Map<number, NumberedCitation>()

  /** The numbers for a text block's search-result citations, deduplicated, in order. */
  add(block: Anthropic.TextBlock): number[] {
    const numbers: number[] = []
    for (const citation of block.citations ?? []) {
      if (citation.type !== 'search_result_location') continue
      let entry = this.#byIndex.get(citation.search_result_index)
      if (entry === undefined) {
        entry = {
          number: this.#byIndex.size + 1,
          source: citation.source,
          title: citation.title ?? citation.source,
          citedText: citation.cited_text,
        }
        this.#byIndex.set(citation.search_result_index, entry)
      }
      if (!numbers.includes(entry.number)) numbers.push(entry.number)
    }
    return numbers
  }

  list(): NumberedCitation[] {
    return [...this.#byIndex.values()].sort((a, b) => a.number - b.number)
  }
}
