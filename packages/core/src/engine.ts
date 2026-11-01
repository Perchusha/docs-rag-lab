// The engine a host runs: the CLI for one command, an app for its whole life
// (ADR-0006, ADR-0007). It turns settings and sources into search, ask and
// document lookups, so the CLI and every app share one code path. Clients are
// created on first use and kept: the rate limiter must see every request of
// the process to hold the provider's limits. Indexes are opened per call,
// which costs a few milliseconds and never holds a write lock between calls.
import { join } from 'node:path'

import type { AnswerEvent, DocumentChunks, RetrievalRequest } from '@docs-rag-lab/contracts'
import type { Settings } from '@docs-rag-lab/settings'
import { DOC_TYPES, type DocType, type Source } from '@docs-rag-lab/source-kit'

import { ask } from './ask.ts'
import { createEmbeddingProvider } from './embeddings/factory.ts'
import type { EmbeddingProvider } from './embeddings/provider.ts'
import { RateLimiter } from './embeddings/rate-limit.ts'
import { createClaudeClient, sectionPathOf, type AnswerClient } from './generate.ts'
import { openIndexes, type OpenIndexes } from './indexes.ts'
import { retrieve, type Retrieval } from './retrieve.ts'
import type { UsageMeter } from './usage.ts'

/** The settings the engine reads; a host passes its whole Settings object. */
export type EngineSettings = Pick<
  Settings,
  'dataDir' | 'embeddings' | 'models' | 'answer' | 'retrieval' | 'pricing'
>

export interface EngineOptions {
  settings: EngineSettings
  /** The configured sources; the first one is the default. */
  sources: readonly Source[]
  /** The repository root; settings.dataDir is relative to it. */
  root: string
  /** For tests. Defaults to the provider and the Claude client named in settings. */
  createProvider?: (() => EmbeddingProvider) | undefined
  createClient?: (() => AnswerClient) | undefined
}

export interface AskRun {
  meter: UsageMeter
  onEvent: (event: AnswerEvent) => void
  signal?: AbortSignal | undefined
}

export interface Engine {
  readonly sources: readonly Source[]
  /** Retrieval only, no Claude call. */
  search(request: RetrievalRequest, meter: UsageMeter): Promise<Retrieval>
  /** Retrieval, then a streamed answer with citations. Throws on failure. */
  ask(request: RetrievalRequest, run: AskRun): Promise<Retrieval>
  /** A document and its chunks in order, or undefined when the path is not indexed. */
  documentChunks(sourceId: string, path: string): DocumentChunks | undefined
}

/** Thrown for a source ID the engine was not given. */
export class UnknownSourceError extends Error {
  constructor(id: string, known: readonly Source[]) {
    super(`unknown source "${id}" (configured: ${known.map((s) => s.id).join(', ')})`)
    this.name = 'UnknownSourceError'
  }
}

/** The request's doc types, checked: an unknown one would silently match nothing. */
function docTypesOf(values: readonly string[] | undefined): DocType[] {
  return (values ?? []).map((value) => {
    const docType = DOC_TYPES.find((known) => known === value)
    if (docType === undefined) {
      throw new Error(`unknown doc type "${value}" (known: ${DOC_TYPES.join(', ')})`)
    }
    return docType
  })
}

function spansOf(metadata: Record<string, unknown>): [number, number][] {
  const spans = metadata.spans
  if (!Array.isArray(spans)) return []
  return spans.filter(
    (span): span is [number, number] =>
      Array.isArray(span) &&
      span.length === 2 &&
      typeof span[0] === 'number' &&
      typeof span[1] === 'number',
  )
}

export function createEngine(options: EngineOptions): Engine {
  const { settings, sources } = options
  const dataDir = join(options.root, settings.dataDir)
  let provider: EmbeddingProvider | undefined
  let client: AnswerClient | undefined
  const limiter = new RateLimiter(settings.embeddings.rateLimit)

  const providerOf = (): EmbeddingProvider =>
    (provider ??= (
      options.createProvider ?? (() => createEmbeddingProvider(settings.embeddings))
    )())
  const clientOf = (): AnswerClient =>
    (client ??= (options.createClient ?? (() => createClaudeClient()))())

  const sourceOf = (id: string | undefined): Source => {
    const source = id === undefined ? sources[0] : sources.find((s) => s.id === id)
    if (source === undefined) throw new UnknownSourceError(id ?? '(none)', sources)
    return source
  }

  const withIndexes = async <T>(
    source: Source,
    run: (indexes: OpenIndexes) => Promise<T> | T,
  ): Promise<T> => {
    const indexes = openIndexes(dataDir, source.id, { create: false })
    try {
      return await run(indexes)
    } finally {
      indexes.close()
    }
  }

  const retrieveOptions = (request: RetrievalRequest, meter: UsageMeter, indexes: OpenIndexes) => ({
    question: request.question,
    source: sourceOf(request.source),
    settings: {
      ...settings.retrieval,
      ...(request.strategy === undefined ? {} : { strategy: request.strategy }),
      ...(request.topK === undefined ? {} : { topK: request.topK }),
    },
    docTypes: docTypesOf(request.docTypes),
    provider: providerOf(),
    index: indexes.index,
    cache: indexes.cache,
    meter,
    limiter,
  })

  return {
    sources,

    // async, so a bad request rejects instead of throwing before a promise exists.
    async search(request, meter) {
      const source = sourceOf(request.source)
      return await withIndexes(source, (indexes) =>
        retrieve(retrieveOptions(request, meter, indexes)),
      )
    },

    async ask(request, run) {
      const source = sourceOf(request.source)
      // Before retrieval, so a missing ANTHROPIC_API_KEY fails before any Voyage call.
      const answerClient = clientOf()
      return await withIndexes(source, (indexes) =>
        ask({
          ...retrieveOptions(request, run.meter, indexes),
          client: answerClient,
          model: settings.models.answer,
          effort: settings.answer.effort,
          maxTokens: settings.answer.maxTokens,
          pricing: settings.pricing,
          onEvent: run.onEvent,
          signal: run.signal,
        }),
      )
    },

    documentChunks(sourceId, path) {
      const source = sourceOf(sourceId)
      const indexes = openIndexes(dataDir, source.id, { create: false })
      try {
        const stored = indexes.index.documentChunks(path)
        if (stored === undefined) return undefined
        return {
          sourceId: source.id,
          path: stored.path,
          url: stored.url,
          title: stored.title,
          docType: stored.docType,
          chunks: stored.chunks.map((chunk) => ({
            chunkId: chunk.chunkId,
            ordinal: chunk.ordinal,
            headingPath: chunk.headingPath,
            sectionPath: sectionPathOf(chunk),
            anchor: chunk.anchor,
            tokenCount: chunk.tokenCount,
            text: chunk.text,
            spans: spansOf(chunk.metadata),
            context: chunk.context,
          })),
        }
      } finally {
        indexes.close()
      }
    },
  }
}
