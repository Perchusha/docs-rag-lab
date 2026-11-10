// Retrieval (SPEC section 9, ADR-0005). `vector` is KNN over embeddings, as in
// M1. `hybrid` fuses three lists with Reciprocal Rank Fusion: vector, BM25
// over the question's terms, and BM25 over its exact tokens (code, identifiers,
// flags, source tokens such as error codes). Every call returns the hits for
// generation and a serializable trace of how they were chosen.
import {
  TRACE_VERSION,
  type ListName,
  type RetrievalTrace,
  type TraceChunk,
  type TraceFusion,
  type TraceList,
  type TraceRerank,
  type TraceRerankedCandidate,
} from '@docs-rag-lab/contracts'
import type {
  Candidate,
  EmbeddingCache,
  RerankCache,
  SearchFilter,
  SearchHit,
  SourceIndex,
} from '@docs-rag-lab/db'
import type { RetrievalSettings } from '@docs-rag-lab/settings'
import type { DocType, Source } from '@docs-rag-lab/source-kit'

import { embedWithCache } from './embeddings/cached.ts'
import type { EmbeddingProvider } from './embeddings/provider.ts'
import type { RateLimiter } from './embeddings/rate-limit.ts'
import { contextualText } from './contexts/text.ts'
import { citationSource, citationTitle, sectionPartOf, sectionPathOf } from './generate.ts'
import { analyzeQuery } from './query.ts'
import { rerankWithCache } from './rerank/cached.ts'
import type { RerankProvider } from './rerank/provider.ts'
import { fuseRrf } from './rrf.ts'
import type { UsageMeter } from './usage.ts'

/**
 * Bump when the code changes what a search ranks for the same settings, so a report
 * says which retrieval it measured (ADR-0010).
 * 1: M2 and M3. The rerank strategy of M5 changes nothing for vector and hybrid.
 */
export const RETRIEVAL_VERSION = 1

/** What the rerank strategy needs. */
export interface RerankStep {
  provider: RerankProvider
  /** How many of the fused candidates are scored, in one call. */
  depth: number
  cache: RerankCache
  limiter?: RateLimiter | undefined
}

export interface RetrieveOptions {
  question: string
  /** The source the index belongs to; its exactTokens hook feeds keyword search. */
  source: Pick<Source, 'id' | 'exactTokens'>
  settings: RetrievalSettings
  /** Only chunks of these doc types; empty or missing means all. */
  docTypes?: readonly DocType[] | undefined
  provider: EmbeddingProvider
  index: SourceIndex
  cache: EmbeddingCache
  meter: UsageMeter
  limiter?: RateLimiter | undefined
  /** Told when the query's embedding waits for the rate limit, with about how long. */
  onWait?: ((ms: number) => void) | undefined
  /** Gives up a wait for the rate limit. */
  signal?: AbortSignal | undefined
  /** Required by the rerank strategy, and not read by the others. */
  rerank?: RerankStep | undefined
  /** Milliseconds, for timings; defaults to performance.now. */
  now?: (() => number) | undefined
}

export interface Retrieval {
  /** The top K chunks, in order, for generation. */
  hits: SearchHit[]
  trace: RetrievalTrace
}

function checkIndex(index: SourceIndex, provider: EmbeddingProvider): void {
  const manifest = index.getManifest()
  if (manifest === undefined) throw new Error('the index is empty: run drl sync first')
  if (manifest.embedModel !== provider.id) {
    throw new Error(
      `the index was built with ${manifest.embedModel}, but the config uses ${provider.id}: run drl sync again`,
    )
  }
}

function toTraceList(
  name: ListName,
  candidates: readonly Candidate[],
  ms: number,
  extra: Pick<TraceList, 'query' | 'skipped'> = {},
): TraceList {
  return {
    name,
    scoring: name === 'vector' ? 'cosine-distance' : 'bm25',
    ...extra,
    ms,
    candidates: candidates.map((c, i) => ({ chunkId: c.chunkId, rank: i + 1, score: c.score })),
  }
}

/** The candidates by score, best first. Equal scores keep the fused order (ADR-0014). */
function rerankedOrder(
  chunkIds: readonly string[],
  scores: readonly number[],
): TraceRerankedCandidate[] {
  return chunkIds
    .map((chunkId, position) => {
      const score = scores[position]
      if (score === undefined) throw new Error(`no rerank score for ${chunkId}`)
      return { chunkId, score, fusedRank: position + 1 }
    })
    .sort((a, b) => b.score - a.score || a.fusedRank - b.fusedRank)
    .map((candidate, position) => ({ ...candidate, rank: position + 1 }))
}

export async function retrieve(options: RetrieveOptions): Promise<Retrieval> {
  const { index, provider, settings, question } = options
  const now = options.now ?? (() => performance.now())
  const start = now()
  checkIndex(index, provider)

  const docTypes = [...(options.docTypes ?? [])]
  const filter: SearchFilter = { docTypes }
  // Lists are at least topK deep, so the context is never cut short by the depth.
  const depth = Math.max(settings.candidates, settings.topK)
  const plan = analyzeQuery(question, options.source.exactTokens?.(question) ?? [])

  let embedFrom: 'cache' | 'api' = 'cache'
  const embedStart = now()
  const [vector] = await embedWithCache([question], {
    provider,
    cache: options.cache,
    inputType: 'query',
    meter: options.meter,
    limiter: options.limiter,
    onWait: options.onWait,
    signal: options.signal,
    onProgress: () => {
      embedFrom = 'api'
    },
  })
  if (vector === undefined) throw new Error('no query vector')
  const embedMs = now() - embedStart

  const timed = <T>(run: () => T): [T, number] => {
    const t = now()
    const result = run()
    return [result, now() - t]
  }

  const [vectorHits, vectorMs] = timed(() => index.searchVectors(vector, depth, filter))
  const lists: TraceList[] = [toTraceList('vector', vectorHits, vectorMs)]

  let fusion: TraceFusion = { method: 'none' }
  let ranking: string[] = vectorHits.map((hit) => hit.chunkId)
  if (settings.strategy !== 'vector') {
    const keywordList = (name: ListName, query: string, none: string): TraceList => {
      if (query === '') return toTraceList(name, [], 0, { skipped: none })
      const [hits, ms] = timed(() => index.searchKeywords(query, depth, filter))
      return toTraceList(name, hits, ms, { query })
    }
    lists.push(
      keywordList('keyword', plan.keywordQuery, 'no search terms in the question'),
      keywordList('exact', plan.exactQuery, 'no exact tokens in the question'),
    )
    const [ranked, fuseMs] = timed(() =>
      fuseRrf(
        lists
          .filter((list) => list.skipped === undefined)
          .map((list) => ({ name: list.name, chunkIds: list.candidates.map((c) => c.chunkId) })),
        settings.rrfK,
      ),
    )
    fusion = { method: 'rrf', k: settings.rrfK, ms: fuseMs, ranked }
    ranking = ranked.map((entry) => entry.chunkId)
  }

  const ids = [...new Set(lists.flatMap((list) => list.candidates.map((c) => c.chunkId)))]
  const records = index.chunksById(ids)
  const recordOf = (id: string): SearchHit => {
    const record = records.get(id)
    if (record === undefined) throw new Error(`candidate ${id} is not in the index`)
    return record
  }

  let rerank: TraceRerank | undefined
  if (settings.strategy === 'rerank') {
    const step = options.rerank
    if (step === undefined) throw new Error('the rerank strategy needs a reranker')
    const rerankStart = now()
    const scored = ranking.slice(0, step.depth)
    const { scores, from, rateLimitRetries } = await rerankWithCache(
      question,
      scored.map((id) => {
        const { context, text } = recordOf(id)
        return contextualText(context, text)
      }),
      { provider: step.provider, cache: step.cache, limiter: step.limiter, meter: options.meter },
    )
    const ranked = rerankedOrder(scored, scores)
    rerank = {
      provider: step.provider.id,
      depth: step.depth,
      from,
      rateLimitRetries,
      ms: now() - rerankStart,
      ranked,
    }
    ranking = [...ranked.map(({ chunkId }) => chunkId), ...ranking.slice(scored.length)]
  }

  const hits = ranking.slice(0, settings.topK).map(recordOf)

  const chunks: Record<string, TraceChunk> = {}
  for (const id of ids) {
    const record = recordOf(id)
    chunks[id] = {
      docPath: record.docPath,
      title: record.title,
      headingPath: record.headingPath,
      sectionPath: sectionPathOf(record),
      part: sectionPartOf(record),
      anchor: record.anchor,
      docType: record.docType,
      tokenCount: record.tokenCount,
    }
  }

  const trace: RetrievalTrace = {
    version: TRACE_VERSION,
    question,
    sourceId: options.source.id,
    strategy: settings.strategy,
    params: { topK: settings.topK, candidates: settings.candidates, rrfK: settings.rrfK },
    filters: { docTypes },
    query: { terms: plan.terms, exactTokens: plan.exactTokens },
    embedding: { provider: provider.id, from: embedFrom, ms: embedMs },
    lists,
    fusion,
    ...(rerank === undefined ? {} : { rerank }),
    chunks,
    context: hits.map((hit, i) => ({
      rank: i + 1,
      chunkId: hit.chunkId,
      source: citationSource(hit),
      title: citationTitle(hit),
      text: hit.text,
    })),
    totalMs: now() - start,
  }
  return { hits, trace }
}
