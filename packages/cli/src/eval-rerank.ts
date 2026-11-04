// drl eval rerank-check: does a rerank score depend on the rest of its batch (ADR-0014)?
// The first questions of the golden set whose fused top documents fit one request are
// scored in several compositions, and every score is compared exactly. The tokens are free,
// but they take minutes on the free trial, so it prints the plan first and needs --yes.
import { join } from 'node:path'

import {
  createRerankProvider,
  estimateRerankTokens,
  isUnanswerable,
  openIndexes,
  planBatchingCheck,
  RateLimiter,
  runBatchingCheck,
  type BatchingCheck,
  type BatchingCheckQuestion,
  type RerankProvider,
} from '@docs-rag-lab/core'

import { findSource, type CommandContext } from './commands.ts'
import { CliError } from './errors.ts'
import { formatDuration } from './format.ts'
import { readGoldenFiles } from './golden.ts'

/** Three questions give about 60 comparisons each, in about 15 minutes all told. */
const QUESTIONS = 3

const count = (n: number): string => n.toLocaleString('en-US')
const calls = (n: number): string => `${String(n)} call${n === 1 ? '' : 's'}`

/** The first answerable questions, in the set's order, whose top documents fit one request. */
async function questionsToCheck(
  ctx: CommandContext,
  sourceId: string,
): Promise<BatchingCheckQuestion[]> {
  const { settings, engine, meter } = ctx
  const source = findSource(ctx.sources, sourceId)
  const indexes = openIndexes(join(ctx.root, settings.dataDir), source.id, { create: false })
  let golden
  try {
    golden = readGoldenFiles(ctx.root, source.id, indexes.index)
  } finally {
    indexes.close()
  }
  if (golden === undefined) throw new CliError(`${source.id} has no golden set`)

  const picked: BatchingCheckQuestion[] = []
  for (const candidate of golden.questions) {
    if (isUnanswerable(candidate)) continue
    const { id, question } = candidate
    const { hits } = await engine.search(
      { question, source: source.id, strategy: 'hybrid', topK: settings.rerank.depth },
      meter,
    )
    const documents = hits.map((hit) => hit.text)
    if (estimateRerankTokens(question, documents) > settings.rerank.rateLimit.tpm) continue
    picked.push({ id, question, documents })
    if (picked.length === QUESTIONS) break
  }
  if (picked.length < QUESTIONS) {
    throw new CliError(`only ${String(picked.length)} questions fit one request under the limit`)
  }
  return picked
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
  lines.push(
    '',
    check.passed
      ? `All ${count(check.compared)} scores match exactly: a score does not depend on its batch.`
      : `${count(check.differing)} of ${count(check.compared)} scores differ.`,
  )
  return lines.join('\n')
}

/** `drl eval rerank-check`. `reranker` is for tests. */
export async function evalRerankCheckCommand(
  ctx: CommandContext,
  args: { source: string; yes: boolean },
  reranker?: RerankProvider,
): Promise<void> {
  const { settings, out } = ctx
  const { batch, rateLimit } = settings.rerank
  const questions = await questionsToCheck(ctx, args.source)
  const plan = planBatchingCheck(questions, batch.maxTokens)
  if (!args.yes) {
    const minutes = Math.max(plan.calls / rateLimit.rpm, plan.estimatedTokens / rateLimit.tpm)
    out.write(
      `this would make ${String(plan.calls)} calls to ${settings.rerank.model} for ${questions.map(({ id }) => id).join(', ')}, about ${count(plan.estimatedTokens)} estimated tokens and ${formatDuration(minutes * 60_000)} at the free-trial limits: add --yes to run them\n`,
    )
    return
  }

  const provider = reranker ?? createRerankProvider(settings.rerank)
  const limiter = new RateLimiter(rateLimit)
  const check = await runBatchingCheck(questions, {
    provider,
    meter: ctx.meter,
    limiter,
    maxTokens: batch.maxTokens,
    onProgress: (id, composition) => {
      out.write(`${id}: ${composition} (${formatDuration(limiter.waitedMs)} waiting so far)\n`)
    },
  })
  out.write(`\n${formatBatchingCheck(check, provider.model)}\n`)
  if (!check.passed) {
    throw new CliError(
      'a rerank score depends on its batch: splitting and caching per pair are not sound, and ADR-0014 asks the owner for a smaller depth before any run',
    )
  }
}
