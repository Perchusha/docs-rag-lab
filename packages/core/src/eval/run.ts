// The retrieval half of an eval run (SPEC section 10, ADR-0010): every scored
// question through the engine's own search, under each strategy, with no Claude
// call. Questions are embedded first, in one batch in ID order: the vectors depend
// on what else is in the request, and one batch also spares the free trial's 3
// requests a minute.
import { createHash } from 'node:crypto'

import {
  EVAL_REPORT_VERSION,
  chunkLabel,
  type EvalReport,
  type EvalResult,
  type EvalRunInfo,
  type EvalStrategyResult,
  type EvalTargetResult,
  type RetrievalTrace,
  type Strategy,
} from '@docs-rag-lab/contracts'
import type { Manifest, SourceIndex } from '@docs-rag-lab/db'
import type { RetrievalSettings } from '@docs-rag-lab/settings'

import type { Engine } from '../engine.ts'
import { RETRIEVAL_VERSION } from '../retrieve.ts'
import type { UsageMeter } from '../usage.ts'
import type { GoldenCheck } from './anchors.ts'
import { compareScores } from './compare.ts'
import { anchorKey, GoldenSetError, type AnchorRef, type GoldenQuestion } from './golden.ts'
import { CONTEXT_CUTOFF, rankingOf, scoreQuestion, strategyResult } from './metrics.ts'

/** A rank a question should reach, from the source's eval/targets.json. */
export interface EvalTarget {
  questionId: string
  anchor: string
  rank: number
}

/** Reads eval/targets.json against the set, so a target cannot name an anchor no question has. */
export function parseEvalTargets(text: string, questions: readonly GoldenQuestion[]): EvalTarget[] {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new GoldenSetError(['the targets file is not valid JSON'])
  }
  if (!Array.isArray(value)) throw new GoldenSetError(['the targets file must be an array'])
  const byId = new Map(questions.map((question) => [question.id, question]))
  const problems: string[] = []
  const targets = value.flatMap((item: unknown, i): EvalTarget[] => {
    const { questionId, anchor, rank } = (item ?? {}) as Partial<Record<keyof EvalTarget, unknown>>
    const where = `target ${String(i + 1)}`
    if (typeof questionId !== 'string' || typeof anchor !== 'string') {
      problems.push(`${where}: it needs questionId and anchor`)
      return []
    }
    if (typeof rank !== 'number' || !Number.isInteger(rank) || rank < 1) {
      problems.push(`${where}: rank must be a whole number from 1`)
      return []
    }
    const question = byId.get(questionId)
    if (question === undefined) {
      problems.push(`${where}: no question ${questionId}`)
      return []
    }
    const anchors = [...question.primary, ...question.acceptable].map(anchorKey)
    if (!anchors.includes(anchor)) {
      problems.push(`${where}: ${questionId} has no anchor ${anchor}`)
      return []
    }
    return [{ questionId, anchor, rank }]
  })
  if (problems.length > 0) throw new GoldenSetError(problems)
  return targets
}

/** A hash of vectors, in order. */
export function vectorsHash(vectors: readonly Float32Array[]): string {
  const hash = createHash('sha256')
  for (const vector of vectors) {
    hash.update(new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength))
  }
  return hash.digest('hex')
}

export interface RetrievalEvalOptions {
  engine: Pick<Engine, 'search' | 'embedQueries'>
  sourceId: string
  questions: readonly GoldenQuestion[]
  check: GoldenCheck
  strategies: readonly Strategy[]
  targets: readonly EvalTarget[]
  manifest: Manifest
  retrieval: RetrievalSettings
  /** The reranker, which the identity names only when the rerank strategy runs. */
  rerank?: { model: string; depth: number } | undefined
  /** The index the corpus fingerprints come from. */
  index: Pick<SourceIndex, 'chunksHash' | 'vectorsHash' | 'schemaVersion'>
  meter: UsageMeter
  /** Who ran it and when: everything a report does not compare. */
  run: Pick<EvalRunInfo, 'name' | 'createdAt' | 'repoSha' | 'repoDirty'>
}

function targetResult(
  target: EvalTarget,
  strategies: readonly EvalStrategyResult[],
  defaultStrategy: Strategy,
): EvalTargetResult {
  const ranks: EvalTargetResult['ranks'] = {}
  for (const { strategy, questions } of strategies) {
    const score = questions.find((question) => question.id === target.questionId)
    ranks[strategy] = score?.anchors.find(({ anchor }) => anchor === target.anchor)?.rank ?? null
  }
  const rank = ranks[defaultStrategy]
  return {
    questionId: target.questionId,
    anchor: target.anchor,
    target: target.rank,
    ranks,
    met: rank === undefined ? null : rank !== null && rank <= target.rank,
  }
}

/** Runs retrieval over the golden set and returns the whole report. */
export async function runRetrievalEval(options: RetrievalEvalOptions): Promise<EvalReport> {
  const { engine, sourceId, check, strategies, manifest, retrieval, index, meter } = options
  if (retrieval.topK !== CONTEXT_CUTOFF) {
    throw new Error(
      `recall@${String(CONTEXT_CUTOFF)} measures the context, and the settings send ${String(retrieval.topK)} chunks`,
    )
  }
  const stale = new Set(check.stale)
  const unanswerable = options.questions.filter((question) => question.primary.length === 0)
  const scored = options.questions
    .filter((question) => question.primary.length > 0 && !stale.has(question.id))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  const queryVectors = await engine.embedQueries(
    // Trimmed as a search trims it, so this is the vector the search will find.
    { source: sourceId, questions: scored.map((question) => question.question.trim()) },
    meter,
  )

  const chunksOf = (anchor: AnchorRef): string[] =>
    (check.lock.anchors[anchorKey(anchor)] ?? []).map((chunk) => chunk.chunkId)
  const chunks: EvalResult['chunks'] = {}
  const timings: EvalRunInfo['timings'] = {}
  const results: EvalStrategyResult[] = []
  let rerankCalls = 0
  let rateLimitRetries = 0
  for (const strategy of strategies) {
    const scores = []
    let totalMs = 0
    let maxMs = 0
    for (const question of scored) {
      const { trace } = await engine.search(
        { question: question.question, source: sourceId, strategy },
        meter,
      )
      totalMs += trace.totalMs
      maxMs = Math.max(maxMs, trace.totalMs)
      if (trace.rerank !== undefined) {
        rerankCalls++
        rateLimitRetries += trace.rerank.rateLimitRetries
      }
      const context = trace.context.map((chunk) => chunk.chunkId)
      recordChunks(chunks, trace, context)
      // Fusion can rank deeper than one list reaches. Both strategies stop at the same
      // depth, or a hybrid rank of 60 would beat a vector search that stopped at 50.
      const ranking = rankingOf(trace).slice(0, retrieval.candidates)
      const top = ranking.slice(0, context.length)
      if (JSON.stringify(top) !== JSON.stringify(context)) {
        throw new Error(
          `${question.id}: the ranking and the context disagree, so the metrics would measure another order than what reaches the answer`,
        )
      }
      scores.push(scoreQuestion(question, ranking, context, chunksOf))
    }
    timings[strategy] = { meanMs: totalMs / Math.max(scored.length, 1), maxMs }
    results.push(strategyResult(strategy, scores))
  }

  const [a, b] = results
  const usage = meter.entries().filter(([, entry]) => entry.kind === 'embedding')
  const settings = Object.fromEntries(
    Object.entries(retrieval).filter(([key]) => key !== 'strategy'),
  )
  return {
    version: EVAL_REPORT_VERSION,
    identity: {
      sourceId,
      docs: { repo: manifest.repo, branch: manifest.branch, sha: manifest.commitSha },
      chunkerVersion: manifest.chunkerVersion,
      parserVersion: manifest.parserVersion,
      indexSchema: index.schemaVersion(),
      embedModel: manifest.embedModel,
      contextModel: manifest.contextModel,
      chunksHash: index.chunksHash(),
      goldenSet: { version: check.setVersion, hash: check.lock.setHash },
      retrievalVersion: RETRIEVAL_VERSION,
      retrieval: settings,
      ...(strategies.includes('rerank') && options.rerank !== undefined
        ? { rerank: { model: options.rerank.model, depth: options.rerank.depth } }
        : {}),
    },
    vectors: { queryHash: vectorsHash(queryVectors), corpusHash: index.vectorsHash() },
    result: {
      scored: scored.length,
      stale: [...check.stale],
      review: [...check.review],
      unanswerable: unanswerable.map((question) => question.id),
      strategies: results,
      comparison:
        a === undefined || b === undefined
          ? null
          : compareScores(
              { name: a.strategy, questions: a.questions },
              { name: b.strategy, questions: b.questions },
            ),
      targets: options.targets.map((target) => targetResult(target, results, retrieval.strategy)),
      chunks: Object.fromEntries(
        Object.entries(chunks).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)),
      ),
    },
    run: {
      ...options.run,
      timings,
      usage: {
        embeddingTokens: usage.reduce((sum, [, entry]) => sum + entry.inputTokens, 0),
        embeddingRequests: usage.reduce((sum, [, entry]) => sum + entry.requests, 0),
      },
      ...(rerankCalls === 0 ? {} : { rerank: { calls: rerankCalls, rateLimitRetries } }),
    },
  }
}

function recordChunks(
  chunks: EvalResult['chunks'],
  trace: RetrievalTrace,
  context: readonly string[],
): void {
  for (const id of context) {
    const chunk = trace.chunks[id]
    if (chunk !== undefined) chunks[id] = { label: chunkLabel(chunk), docPath: chunk.docPath }
  }
}
