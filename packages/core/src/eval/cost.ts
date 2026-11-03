// The estimate printed before any paid call (SPEC section 10). Answer input comes from the
// free token count, and everything else from what past calls of the same kind used. Until
// there are past calls, it uses the assumptions below, and says so.
import type { EvalCache } from '@docs-rag-lab/db'
import type { ModelPrice, PricingSettings } from '@docs-rag-lab/settings'

import type { AnswerJob, EvalClient } from './answers.ts'
import { isUnanswerable } from './judge.ts'

/** A guess until the pilot replaces it: the journal's answers cost $0.017 to $0.025. */
const ASSUMED_ANSWER_OUTPUT = 500
/** A guess until the pilot replaces it. The judge's output includes its thinking. */
const ASSUMED_JUDGE_INPUT = 1_500
const ASSUMED_JUDGE_OUTPUT = 800

/** Past calls of a kind count only from this many, so that one call is not a forecast. */
const ENOUGH_CALLS = 5

export interface CostLine {
  calls: number
  /** Calls the cache already holds, which cost nothing. */
  cached: number
  inputTokens: number
  outputTokens: number
  usd: number
}

export interface EvalCostEstimate {
  answers: CostLine
  judge: CostLine
  usd: number
  /** Whether the output sizes are guesses, because too few calls have been made yet. */
  assumed: boolean
  pricesChecked: string
}

function priced(price: ModelPrice | undefined, input: number, output: number): number {
  if (price?.output === undefined) throw new Error('no price for a model the run would call')
  return (input * price.input + output * price.output) / 1_000_000
}

/** The free count has a rate limit of its own, so only so many at once. */
const COUNTS_AT_ONCE = 8

async function inputTokensOf(jobs: readonly AnswerJob[], client: EvalClient): Promise<number> {
  let total = 0
  for (let i = 0; i < jobs.length; i += COUNTS_AT_ONCE) {
    const counts = await Promise.all(
      jobs.slice(i, i + COUNTS_AT_ONCE).map(async ({ request }) => {
        const { model, system, messages, output_config: outputConfig } = request
        const { input_tokens: tokens } = await client.messages.countTokens({
          model,
          ...(system === undefined ? {} : { system }),
          messages,
          ...(outputConfig === undefined ? {} : { output_config: outputConfig }),
        })
        return tokens
      }),
    )
    total += counts.reduce((sum, tokens) => sum + tokens, 0)
  }
  return total
}

export interface EstimateOptions {
  jobs: readonly AnswerJob[]
  client: EvalClient
  cache: EvalCache
  pricing: PricingSettings
  answerModel: string
  judgeModel: string
  /** A second opinion on row 3's first answers. */
  retest: boolean
}

/** What the run would pay. It calls count_tokens, which is free, and nothing else. */
export async function estimateCost(options: EstimateOptions): Promise<EvalCostEstimate> {
  const { jobs, client, cache, pricing, answerModel, judgeModel, retest } = options
  const missing = jobs.filter((job) => !cache.has(job.key))
  const answerStats = cache.stats('answer')
  const judgeStats = cache.stats('judge')
  const enough = (calls: number): boolean => calls >= ENOUGH_CALLS
  const outputPerAnswer = enough(answerStats.calls)
    ? answerStats.meanOutputTokens
    : ASSUMED_ANSWER_OUTPUT
  const inputPerJudge = enough(judgeStats.calls) ? judgeStats.meanInputTokens : ASSUMED_JUDGE_INPUT
  const outputPerJudge = enough(judgeStats.calls)
    ? judgeStats.meanOutputTokens
    : ASSUMED_JUDGE_OUTPUT

  const answerInput = await inputTokensOf(missing, client)
  const answerOutput = missing.length * outputPerAnswer
  const answers: CostLine = {
    calls: jobs.length,
    cached: jobs.length - missing.length,
    inputTokens: answerInput,
    outputTokens: answerOutput,
    usd: priced(pricing.models[answerModel], answerInput, answerOutput),
  }

  // A verdict per new answer, a support check per new answer that may cite, and second
  // opinions. An answer already cached is taken to be judged already too.
  const judgeCalls =
    missing.length +
    missing.filter((job) => job.row !== 0 && !isUnanswerable(job.question)).length +
    (retest ? missing.filter((job) => job.row === 3 && job.sample === 1).length : 0)
  const judgeInput = judgeCalls * inputPerJudge
  const judgeOutput = judgeCalls * outputPerJudge
  const judge: CostLine = {
    calls: judgeCalls,
    cached: 0,
    inputTokens: judgeInput,
    outputTokens: judgeOutput,
    usd: priced(pricing.models[judgeModel], judgeInput, judgeOutput),
  }
  return {
    answers,
    judge,
    usd: answers.usd + judge.usd,
    assumed: !enough(answerStats.calls) || !enough(judgeStats.calls),
    pricesChecked: pricing.checked,
  }
}
