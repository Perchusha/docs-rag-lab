// Shared fakes for core's tests: a deterministic embedding provider that
// records every text it embeds, a tiny markdown source, and a Claude client
// that replays a recorded answer. Not exported from the package entry.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

import type Anthropic from '@anthropic-ai/sdk'
import type { Block, ParsedDoc, Section, Source, SourceFile } from '@docs-rag-lab/source-kit'

import type { EmbeddingProvider, EmbedResult, InputType } from './embeddings/provider.ts'
import type { AnswerClient, AnswerStream } from './generate.ts'

// Hand-built in the shape of the search results docs: two cited search
// results, one cited twice, plus uncited text and an empty thinking block.
export const ANSWER_MESSAGE = JSON.parse(
  readFileSync(new URL('./__fixtures__/answer-message.json', import.meta.url), 'utf8'),
) as Anthropic.Message

export interface FakeAnswerClient extends AnswerClient {
  readonly requests: Anthropic.MessageCreateParamsNonStreaming[]
  readonly signals: (AbortSignal | undefined)[]
}

/**
 * A Claude client whose stream replays the text blocks of `message`. It can
 * fail after the first block, and it stops with an abort error when its
 * signal is aborted between blocks, like the SDK.
 */
export function fakeAnswerClient(
  options: {
    message?: Anthropic.Message
    failAfterFirstBlock?: boolean
    /** Called after each block, for example to abort part-way. */
    afterBlock?: (index: number) => void
  } = {},
): FakeAnswerClient {
  const message = options.message ?? ANSWER_MESSAGE
  const textBlocks = message.content.filter(
    (block): block is Anthropic.TextBlock => block.type === 'text',
  )
  const requests: Anthropic.MessageCreateParamsNonStreaming[] = []
  const signals: (AbortSignal | undefined)[] = []
  return {
    requests,
    signals,
    messages: {
      stream(request, streamOptions) {
        requests.push(request)
        signals.push(streamOptions?.signal)
        const listeners: {
          text: ((d: string) => void)[]
          block: ((b: Anthropic.ContentBlock) => void)[]
        } = { text: [], block: [] }
        let current: Anthropic.Message | undefined
        const stream: AnswerStream = {
          on(event: 'text' | 'contentBlock', listener: never) {
            if (event === 'text') listeners.text.push(listener)
            else listeners.block.push(listener)
            return stream
          },
          get currentMessage() {
            return current
          },
          finalMessage() {
            for (const [i, block] of textBlocks.entries()) {
              if (streamOptions?.signal?.aborted === true) {
                return Promise.reject(new Error('Request was aborted.'))
              }
              current = { ...message, usage: { ...message.usage, output_tokens: 10 * (i + 1) } }
              for (const listener of listeners.text) listener(block.text)
              for (const listener of listeners.block) listener(block)
              options.afterBlock?.(i)
              if (options.failAfterFirstBlock === true) {
                return Promise.reject(new Error('connection reset'))
              }
            }
            current = message
            return Promise.resolve(message)
          },
        }
        return stream
      },
    },
  }
}

/** A unit vector derived from the text's hash. */
export function fakeVector(text: string, dimensions: number): Float32Array {
  const bytes = createHash('sha256').update(text).digest()
  const vector = Float32Array.from(
    { length: dimensions },
    (_, i) => (bytes[i % bytes.length] ?? 0) - 127.5,
  )
  const norm = Math.hypot(...vector)
  return vector.map((value) => value / norm)
}

export class RecordingProvider implements EmbeddingProvider {
  readonly id: string
  readonly model = 'fake-embed'
  readonly dimensions: number
  readonly limits: { maxInputs: number; maxTokens: number }
  readonly calls: { texts: string[]; inputType: InputType }[] = []

  constructor(options: { dimensions?: number; maxInputs?: number; maxTokens?: number } = {}) {
    this.dimensions = options.dimensions ?? 8
    this.id = `fake:hash:${String(this.dimensions)}`
    this.limits = { maxInputs: options.maxInputs ?? 100, maxTokens: options.maxTokens ?? 100_000 }
  }

  /** Every text sent to the provider, across calls. */
  get embedded(): string[] {
    return this.calls.flatMap((call) => call.texts)
  }

  embed(texts: readonly string[], inputType: InputType): Promise<EmbedResult> {
    this.calls.push({ texts: [...texts], inputType })
    return Promise.resolve({
      vectors: texts.map((text) => fakeVector(text, this.dimensions)),
      tokens: texts.reduce((sum, text) => sum + text.split(/\s+/).length, 0),
    })
  }
}

/** '# Title' on the first line, '## Heading' sections, one prose block per paragraph. */
export function parseDemoMarkdown(file: SourceFile): ParsedDoc {
  const [first = '', ...rest] = file.content.split('\n')
  const sections: Section[] = [{ headingPath: [], anchor: '', blocks: [] }]
  for (const paragraph of rest.join('\n').split(/\n{2,}/)) {
    const text = paragraph.trim()
    if (text === '') continue
    if (text.startsWith('## ')) {
      const heading = text.slice(3)
      sections.push({
        headingPath: [heading],
        anchor: heading.toLowerCase().replaceAll(' ', '-'),
        blocks: [],
      })
      continue
    }
    const block: Block = { kind: 'prose', text }
    sections[sections.length - 1]?.blocks.push(block)
  }
  return {
    title: first.replace(/^# /, ''),
    url: `https://docs.example.com/${file.path.replace(/\.md$/, '')}`,
    docType: 'handbook',
    sections,
    metadata: { path: file.path },
  }
}

export function demoSource(repo: string, include = ['docs']): Source {
  return {
    id: 'demo',
    repo,
    branch: 'main',
    include,
    license: { name: 'MIT', url: 'https://example.com', attribution: 'Demo' },
    parserVersion: 1,
    match: (path) => path.endsWith('.md'),
    parse: (file) => Promise.resolve(parseDemoMarkdown(file)),
  }
}

/** A paragraph of about `tokens` estimated tokens, made of `word`. */
export function paragraph(tokens: number, word: string): string {
  return Array.from({ length: Math.ceil((tokens * 3.5) / (word.length + 1)) }, () => word).join(' ')
}
