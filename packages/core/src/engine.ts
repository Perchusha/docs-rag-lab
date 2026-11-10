// The engine a host runs: the CLI for one command, an app for its whole life
// (ADR-0006, ADR-0007). It turns settings and sources into search, ask and
// document lookups, so the CLI and every app share one code path. Clients are
// created on first use and kept: the rate limiter must see every request of
// the process to hold the provider's limits. Indexes are opened per call,
// which costs a few milliseconds and never holds a write lock between calls.
import { join } from 'node:path'

import {
  STRATEGIES,
  type AnswerEvent,
  type DocumentChunks,
  type RetrievalRequest,
  type Strategy,
} from '@docs-rag-lab/contracts'
import type { Settings } from '@docs-rag-lab/settings'
import { DOC_TYPES, type DocType, type Source } from '@docs-rag-lab/source-kit'

import { ask, askAgentic } from './ask.ts'
import { embedWithCache } from './embeddings/cached.ts'
import { createEmbeddingProvider } from './embeddings/factory.ts'
import type { EmbeddingProvider } from './embeddings/provider.ts'
import { RateLimiter } from './embeddings/rate-limit.ts'
import {
  createClaudeClient,
  sectionPartOf,
  sectionPathOf,
  spansOf,
  type AnswerClient,
} from './generate.ts'
import { openIndexes, type IndexVariant, type OpenIndexes } from './indexes.ts'
import { createRerankProvider } from './rerank/factory.ts'
import type { RerankProvider } from './rerank/provider.ts'
import { retrieve, type Retrieval } from './retrieve.ts'
import type { UsageMeter } from './usage.ts'

/** The settings the engine reads; a host passes its whole Settings object. */
export type EngineSettings = Pick<
  Settings,
  'dataDir' | 'embeddings' | 'rerank' | 'models' | 'answer' | 'retrieval' | 'agentic' | 'pricing'
>

export interface EngineOptions {
  settings: EngineSettings
  /** The configured sources; the first one is the default. */
  sources: readonly Source[]
  /** The repository root; settings.dataDir is relative to it. */
  root: string
  /** Search this index of each source instead of the plain one. */
  variant?: IndexVariant | undefined
  /** For tests. Defaults to the providers and the Claude client named in settings. */
  createProvider?: (() => EmbeddingProvider) | undefined
  createReranker?: (() => RerankProvider) | undefined
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
  /**
   * Embeds questions into the cache together, in order, so later searches find
   * them there. One request instead of one per question, under the same rate limiter.
   */
  embedQueries(
    request: { source?: string | undefined; questions: readonly string[] },
    meter: UsageMeter,
  ): Promise<Float32Array[]>
  /** Retrieval, then a streamed answer with citations. Throws on failure. */
  ask(request: RetrievalRequest, run: AskRun): Promise<Retrieval>
  /**
   * Agentic mode (ADR-0019): ask's search, then Claude may search again with the same strategy,
   * up to settings.agentic.maxSearches times. Returns the first retrieval. Throws on failure.
   */
  askAgentic(request: RetrievalRequest, run: AskRun): Promise<Retrieval>
  /** The doc types a source's index holds, sorted, which search_docs can filter by. */
  docTypes(sourceId?: string): string[]
  /** A document and its chunks in order, or undefined when the path is not indexed. */
  documentChunks(sourceId: string, path: string): DocumentChunks | undefined
}

/**
 * The most chunks a request may send to the answer. More would not make a
 * useful answer request, and sqlite-vec caps k at 4096.
 */
export const MAX_TOP_K = 100

/** Thrown for a source ID the engine was not given. */
export class UnknownSourceError extends Error {
  constructor(id: string, known: readonly Source[]) {
    super(`unknown source "${id}" (configured: ${known.map((s) => s.id).join(', ')})`)
    this.name = 'UnknownSourceError'
  }
}

/**
 * A request field the engine cannot use. Hosts may check fields earlier, with
 * their own messages (the CLI does, per flag); the engine checks them anyway,
 * because an app forwards what a browser sent.
 */
export class InvalidRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidRequestError'
  }
}

interface CheckedRequest {
  question: string
  strategy: Strategy | undefined
  topK: number | undefined
  docTypes: DocType[]
}

/** Doc types the index's own list let through, so each is a known one. */
const docTypesOf = (values: readonly string[]): DocType[] =>
  DOC_TYPES.filter((known) => values.includes(known))

function checkRequest(request: RetrievalRequest): CheckedRequest {
  const question = request.question.trim()
  if (question === '') throw new InvalidRequestError('the question is empty')
  const { strategy, topK } = request
  if (strategy !== undefined && !STRATEGIES.includes(strategy)) {
    throw new InvalidRequestError(
      `unknown strategy "${strategy}" (known: ${STRATEGIES.join(', ')})`,
    )
  }
  if (topK !== undefined && (!Number.isInteger(topK) || topK < 1 || topK > MAX_TOP_K)) {
    throw new InvalidRequestError(
      `top K must be a whole number from 1 to ${String(MAX_TOP_K)}, got ${String(topK)}`,
    )
  }
  // An unknown doc type would silently match nothing.
  const docTypes = (request.docTypes ?? []).map((value) => {
    const docType = DOC_TYPES.find((known) => known === value)
    if (docType === undefined) {
      throw new InvalidRequestError(`unknown doc type "${value}" (known: ${DOC_TYPES.join(', ')})`)
    }
    return docType
  })
  return { question, strategy, topK, docTypes }
}

export function createEngine(options: EngineOptions): Engine {
  const { settings, sources, variant } = options
  const dataDir = join(options.root, settings.dataDir)
  let provider: EmbeddingProvider | undefined
  let reranker: RerankProvider | undefined
  let client: AnswerClient | undefined
  const limiter = new RateLimiter(settings.embeddings.rateLimit)
  // Limits are per model, so rerank calls do not wait on embeddings.
  const rerankLimiter = new RateLimiter(settings.rerank.rateLimit)

  const providerOf = (): EmbeddingProvider =>
    (provider ??= (
      options.createProvider ?? (() => createEmbeddingProvider(settings.embeddings))
    )())
  const rerankerOf = (): RerankProvider =>
    (reranker ??= (options.createReranker ?? (() => createRerankProvider(settings.rerank)))())
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
    const indexes = openIndexes(dataDir, source.id, { create: false, variant })
    try {
      return await run(indexes)
    } finally {
      indexes.close()
    }
  }

  const retrieveOptions = (
    source: Source,
    request: CheckedRequest,
    meter: UsageMeter,
    indexes: OpenIndexes,
    run?: AskRun,
  ) => ({
    question: request.question,
    // A chat says when its search waits on the embedding rate limit, and Stop ends the wait.
    ...(run === undefined
      ? {}
      : {
          onWait: (ms: number) => {
            run.onEvent({ type: 'wait', ms })
          },
          signal: run.signal,
        }),
    source,
    settings: {
      ...settings.retrieval,
      ...(request.strategy === undefined ? {} : { strategy: request.strategy }),
      ...(request.topK === undefined ? {} : { topK: request.topK }),
    },
    docTypes: request.docTypes,
    provider: providerOf(),
    index: indexes.index,
    cache: indexes.cache,
    meter,
    limiter,
    ...((request.strategy ?? settings.retrieval.strategy) === 'rerank'
      ? {
          rerank: {
            provider: rerankerOf(),
            depth: settings.rerank.depth,
            cache: indexes.rerankCache(),
            limiter: rerankLimiter,
          },
        }
      : {}),
  })

  return {
    sources,

    // async, so a bad request rejects instead of throwing before a promise exists.
    async search(request, meter) {
      const checked = checkRequest(request)
      const source = sourceOf(request.source)
      return await withIndexes(source, (indexes) =>
        retrieve(retrieveOptions(source, checked, meter, indexes)),
      )
    },

    async embedQueries(request, meter) {
      const source = sourceOf(request.source)
      return await withIndexes(source, (indexes) =>
        embedWithCache(request.questions, {
          provider: providerOf(),
          cache: indexes.cache,
          inputType: 'query',
          meter,
          limiter,
        }),
      )
    },

    async ask(request, run) {
      const checked = checkRequest(request)
      const source = sourceOf(request.source)
      // Before retrieval, so a missing ANTHROPIC_API_KEY fails before any Voyage call.
      const answerClient = clientOf()
      return await withIndexes(source, (indexes) =>
        ask({
          ...retrieveOptions(source, checked, run.meter, indexes, run),
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

    async askAgentic(request, run) {
      const checked = checkRequest(request)
      const source = sourceOf(request.source)
      const answerClient = clientOf()
      return await withIndexes(source, (indexes) => {
        const toolDocTypes = indexes.index.stats().byDocType.map(({ docType }) => docType)
        return askAgentic({
          ...retrieveOptions(source, checked, run.meter, indexes, run),
          client: answerClient,
          model: settings.models.answer,
          effort: settings.answer.effort,
          maxTokens: settings.answer.maxTokens,
          pricing: settings.pricing,
          onEvent: run.onEvent,
          signal: run.signal,
          toolDocTypes,
          maxSearches: settings.agentic.maxSearches,
          // A search of Claude's own takes the request's strategy and top K, and its own doc
          // types: the request's filter is for the first search, and the tool says which to use.
          search: (query, docTypes) =>
            retrieve(
              retrieveOptions(
                source,
                { ...checked, question: query, docTypes: docTypesOf(docTypes) },
                run.meter,
                indexes,
                run,
              ),
            ),
        })
      })
    },

    docTypes(sourceId) {
      const source = sourceOf(sourceId)
      const indexes = openIndexes(dataDir, source.id, { create: false, variant })
      try {
        return indexes.index.stats().byDocType.map(({ docType }) => docType)
      } finally {
        indexes.close()
      }
    },

    documentChunks(sourceId, path) {
      const source = sourceOf(sourceId)
      const indexes = openIndexes(dataDir, source.id, { create: false, variant })
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
            part: sectionPartOf(chunk),
            anchor: chunk.anchor,
            tokenCount: chunk.tokenCount,
            text: chunk.text,
            spans: spansOf(chunk),
            context: chunk.context,
          })),
        }
      } finally {
        indexes.close()
      }
    },
  }
}
