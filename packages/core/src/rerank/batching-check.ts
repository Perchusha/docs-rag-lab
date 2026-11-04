// Does a rerank score depend on the rest of its batch? ADR-0014: splitting a top 20 under
// the rate limit and caching scores per pair are only sound if it does not, and Voyage's
// embeddings do depend on theirs. So the same documents are scored in several compositions,
// and every score is compared exactly with the first call's. The repeat tells jitter from
// an effect of the batch. Nothing here is cached: each score must come from the API.
import { requestWithRetries, type ProviderRequestOptions } from '../provider-request.ts'
import type { UsageMeter } from '../usage.ts'
import {
  batchForRerank,
  estimateRerankTokens,
  type RerankProvider,
  type RerankResult,
} from './provider.ts'

export type CompositionName = 'repeat' | 'reversed' | 'halves' | 'batched' | 'alone'

export interface Composition {
  name: CompositionName
  /** Each call, as positions in the question's documents. */
  calls: number[][]
}

export interface BatchingCheckQuestion {
  id: string
  question: string
  documents: readonly string[]
}

export interface CompositionResult {
  name: CompositionName
  calls: number
  /** Scores compared with the first call. */
  compared: number
  /** Of those, how many are not exactly equal. */
  differing: number
  largestDifference: number
  /** Whether the compared documents rank differently from the first call. */
  orderChanged: boolean
}

export interface QuestionCheck {
  id: string
  documents: number
  /** The first call's scores, in document order. */
  scores: number[]
  /** Billed tokens of the first call. */
  tokens: number
  compositions: CompositionResult[]
}

export interface BatchingCheck {
  questions: QuestionCheck[]
  compared: number
  differing: number
  passed: boolean
}

export interface BatchingCheckOptions extends ProviderRequestOptions {
  provider: RerankProvider
  meter: UsageMeter
  /** The limit on one request, as a run would split them. */
  maxTokens: number
  onProgress?: ((id: string, composition: CompositionName | 'first call') => void) | undefined
}

/**
 * The compositions to compare with one call of all documents: that call again, the reverse
 * order, two halves, the split a run would make, and the shortest, middle and longest
 * document each alone, where no padding or neighbour could matter.
 */
export function compositionsOf(
  question: string,
  documents: readonly string[],
  maxTokens: number,
): Composition[] {
  const all = documents.map((_, position) => position)
  const middle = Math.ceil(all.length / 2)
  const lengthOf = (position: number): number => documents[position]?.length ?? 0
  const bySize = [...all].sort((a, b) => lengthOf(a) - lengthOf(b) || a - b)
  const alone = [bySize[0], bySize[Math.floor(bySize.length / 2)], bySize.at(-1)]
  return [
    { name: 'repeat', calls: [all] },
    { name: 'reversed', calls: [[...all].reverse()] },
    { name: 'halves', calls: [all.slice(0, middle), all.slice(middle)] },
    { name: 'batched', calls: batchForRerank(question, documents, maxTokens) },
    {
      name: 'alone',
      calls: [...new Set(alone)]
        .filter((position) => position !== undefined)
        .map((position) => [position]),
    },
  ]
}

/** What the check would cost: requests and estimated tokens. */
export function planBatchingCheck(
  questions: readonly BatchingCheckQuestion[],
  maxTokens: number,
): { calls: number; estimatedTokens: number } {
  let calls = 0
  let estimatedTokens = 0
  for (const { question, documents } of questions) {
    calls++
    estimatedTokens += estimateRerankTokens(question, documents)
    for (const composition of compositionsOf(question, documents, maxTokens)) {
      for (const call of composition.calls) {
        calls++
        estimatedTokens += estimateRerankTokens(
          question,
          call.map((position) => documents[position] ?? ''),
        )
      }
    }
  }
  return { calls, estimatedTokens }
}

/** Positions from the best score to the worst. Equal scores keep document order. */
function rankingOf(scores: ReadonlyMap<number, number>): number[] {
  return [...scores.entries()]
    .sort(([a, scoreA], [b, scoreB]) => scoreB - scoreA || a - b)
    .map(([position]) => position)
}

export async function runBatchingCheck(
  questions: readonly BatchingCheckQuestion[],
  options: BatchingCheckOptions,
): Promise<BatchingCheck> {
  const { provider, meter, limiter, maxRetries } = options

  const scoreCall = async (
    question: string,
    documents: readonly string[],
  ): Promise<RerankResult> => {
    const result = await requestWithRetries(
      estimateRerankTokens(question, documents),
      () => provider.rerank(question, documents),
      { limiter, maxRetries },
    )
    meter.recordRerank(provider.model, result.tokens)
    return result
  }

  const checks: QuestionCheck[] = []
  for (const { id, question, documents } of questions) {
    options.onProgress?.(id, 'first call')
    const first = await scoreCall(question, documents)
    const compositions: CompositionResult[] = []
    for (const { name, calls } of compositionsOf(question, documents, options.maxTokens)) {
      options.onProgress?.(id, name)
      const scores = new Map<number, number>()
      for (const call of calls) {
        const result = await scoreCall(
          question,
          call.map((position) => documents[position] ?? ''),
        )
        call.forEach((position, i) => {
          const score = result.scores[i]
          if (score === undefined) throw new Error(`no score for position ${String(i)}`)
          scores.set(position, score)
        })
      }
      const baseline = new Map(
        [...scores.keys()].map((position) => [position, first.scores[position] ?? Number.NaN]),
      )
      const differences = [...scores].map(([position, score]) =>
        Math.abs(score - (baseline.get(position) ?? Number.NaN)),
      )
      compositions.push({
        name,
        calls: calls.length,
        compared: scores.size,
        // NaN counts as differing: it would mean a missing score.
        differing: differences.filter((difference) => difference !== 0).length,
        largestDifference: differences.reduce((largest, d) => Math.max(largest, d), 0),
        orderChanged: rankingOf(scores).join() !== rankingOf(baseline).join(),
      })
    }
    checks.push({
      id,
      documents: documents.length,
      scores: first.scores,
      tokens: first.tokens,
      compositions,
    })
  }

  const all = checks.flatMap((check) => check.compositions)
  const differing = all.reduce((sum, result) => sum + result.differing, 0)
  return {
    questions: checks,
    compared: all.reduce((sum, result) => sum + result.compared, 0),
    differing,
    passed: differing === 0,
  }
}
