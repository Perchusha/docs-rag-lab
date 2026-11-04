// What rerank costs a run, and drl eval rerank-check: how does a rerank score depend on the
// rest of its call (ADR-0014)? The first questions of the golden set whose fused top documents
// fit one request under the limit are scored in several compositions, and every score is
// compared exactly. The tokens are free, but they take minutes on the free trial, so both print
// their plan first and need --yes.
import { join } from 'node:path'

import {
  contextualText,
  estimateRerankTokens,
  isUnanswerable,
  openIndexes,
  planBatchingCheck,
  RateLimiter,
  rerankCacheKey,
  runBatchingCheck,
  type BatchingCheck,
  type BatchingCheckQuestion,
  type IndexVariant,
} from '@docs-rag-lab/core'

import { findSource, rerankerFor, type CommandContext } from './commands.ts'
import { CliError } from './errors.ts'
import { formatDuration } from './format.ts'
import { readGoldenFiles } from './golden.ts'

/** Three questions give about 80 comparisons each, in about 15 minutes all told. */
const QUESTIONS = 3

/** The split first planned for a run, which ADR-0014's finding measures. */
const SPLIT_TOKENS = 3_600

const count = (n: number): string => n.toLocaleString('en-US')
const calls = (n: number): string => `${String(n)} call${n === 1 ? '' : 's'}`

/** The fused top documents of every answerable question that is not stale, in the set's order. */
async function fusedTops(
  ctx: CommandContext,
  sourceId: string,
  variant?: IndexVariant,
): Promise<BatchingCheckQuestion[]> {
  const { settings, meter } = ctx
  const engine = variant === undefined ? ctx.engine : ctx.engineFor(variant)
  const source = findSource(ctx.sources, sourceId)
  const indexes = openIndexes(join(ctx.root, settings.dataDir), source.id, {
    create: false,
    variant,
  })
  let golden
  try {
    golden = readGoldenFiles(ctx.root, source.id, indexes.index)
  } finally {
    indexes.close()
  }
  if (golden === undefined) throw new CliError(`${source.id} has no golden set`)

  const stale = new Set(golden.check.stale)
  const tops: BatchingCheckQuestion[] = []
  for (const candidate of golden.questions) {
    if (isUnanswerable(candidate) || stale.has(candidate.id)) continue
    const { id, question } = candidate
    const { hits } = await engine.search(
      { question, source: source.id, strategy: 'hybrid', topK: settings.rerank.depth },
      meter,
    )
    tops.push({
      id,
      question,
      documents: hits.map(({ context, text }) => contextualText(context, text)),
    })
  }
  return tops
}

/** How long a number of calls and tokens takes at the limits. */
function durationOf(ctx: CommandContext, requests: number, estimatedTokens: number): string {
  const { rpm, tpm } = ctx.settings.rerank.rateLimit
  return formatDuration(Math.max(requests / rpm, estimatedTokens / tpm) * 60_000)
}

/** What a run would call the reranker for: the calls that are not in the cache yet. */
export async function planRerankRun(
  ctx: CommandContext,
  sourceId: string,
  variant?: IndexVariant,
): Promise<{ calls: number; estimatedTokens: number; duration: string }> {
  const { settings } = ctx
  const tops = await fusedTops(ctx, sourceId, variant)
  const provider = rerankerFor(ctx)
  const indexes = openIndexes(join(ctx.root, settings.dataDir), sourceId, { create: false })
  try {
    const cache = indexes.rerankCache()
    const missing = tops.filter(
      ({ question, documents }) =>
        cache.get(rerankCacheKey(provider.id, question.trim(), documents)) === undefined,
    )
    const estimatedTokens = missing.reduce(
      (sum, { question, documents }) => sum + estimateRerankTokens(question, documents),
      0,
    )
    return {
      calls: missing.length,
      estimatedTokens,
      duration: durationOf(ctx, missing.length, estimatedTokens),
    }
  } finally {
    indexes.close()
  }
}

/** How many decimals the scores carry, since an exact match means no more than that. */
function decimalsOf(scores: readonly number[]): number {
  return Math.max(...scores.map((score) => String(score).split('.')[1]?.length ?? 0))
}

export function formatBatchingCheck(check: BatchingCheck, model: string): string {
  const lines = [`${model}: every score compared exactly with the first call`]
  for (const question of check.questions) {
    lines.push(
      '',
      `${question.id}: ${String(question.documents)} documents, ${count(question.tokens)} billed tokens in one call, scores with up to ${String(decimalsOf(question.scores))} decimals`,
    )
    for (const result of question.compositions) {
      const found =
        result.differing === 0
          ? '0 differ'
          : `${String(result.differing)} differ, by at most ${String(result.largestDifference)}, order ${result.orderChanged ? 'changed' : 'unchanged'}`
      lines.push(
        `  ${result.name.padEnd(9)}${calls(result.calls).padEnd(9)}${String(result.compared)} compared, ${found}`,
      )
    }
  }
  const { identicalSets: same, differentSets: other } = check
  lines.push(
    '',
    same.differing === 0
      ? `Identical sets: all ${count(same.compared)} scores match exactly, in any order.`
      : `Identical sets: ${count(same.differing)} of ${count(same.compared)} scores differ, by at most ${String(same.largestDifference)}.`,
    `Different sets: ${count(other.differing)} of ${count(other.compared)} scores differ, by at most ${String(other.largestDifference)}.`,
  )
  return lines.join('\n')
}

/** `drl eval rerank-check`. */
export async function evalRerankCheckCommand(
  ctx: CommandContext,
  args: { source: string; yes: boolean },
): Promise<void> {
  const { settings, out } = ctx
  const { rateLimit, model } = settings.rerank
  const questions = (await fusedTops(ctx, args.source))
    .filter(({ question, documents }) => estimateRerankTokens(question, documents) <= rateLimit.tpm)
    .slice(0, QUESTIONS)
  if (questions.length === 0) throw new CliError('no question fits one request under the limit')
  const plan = planBatchingCheck(questions, SPLIT_TOKENS)
  if (!args.yes) {
    out.write(
      `this would make ${String(plan.calls)} calls to ${model} for ${questions.map(({ id }) => id).join(', ')}, about ${count(plan.estimatedTokens)} estimated tokens and ${durationOf(ctx, plan.calls, plan.estimatedTokens)} at the free-trial limits: add --yes to run them\n`,
    )
    return
  }

  const provider = rerankerFor(ctx)
  const limiter = new RateLimiter(rateLimit)
  const check = await runBatchingCheck(questions, {
    provider,
    meter: ctx.meter,
    limiter,
    maxTokens: SPLIT_TOKENS,
    onProgress: (id, composition) => {
      out.write(`${id}: ${composition} (${formatDuration(limiter.waitedMs)} waiting so far)\n`)
    },
  })
  out.write(`\n${formatBatchingCheck(check, provider.model)}\n`)
  if (check.identicalSets.differing > 0) {
    throw new CliError(
      'the same documents gave other scores, so a run could not be reproduced without its cache (ADR-0014)',
    )
  }
}
