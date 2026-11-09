// The estimate printed before any paid call (SPEC section 10). Answer input comes from the
// free token count, and everything else from what past calls of the same kind used. Until
// there are past calls, it uses the assumptions below, and says so.
import type { EvalCache } from '@docs-rag-lab/db'
import type { ModelPrice, PricingSettings } from '@docs-rag-lab/settings'

import {
  AGENT_ROW,
  agentRunKey,
  cachedAnswer,
  judgeCallsOf,
  type AgentRunScope,
  type AnswerJob,
  type EvalClient,
} from './answers.ts'
import { isUnanswerable, type JudgeSettings } from './judge.ts'

/** A guess until the pilot replaces it: the journal's answers cost $0.017 to $0.025. */
const ASSUMED_ANSWER_OUTPUT = 500
/** A guess until the pilot replaces it. The judge's output includes its thinking. */
const ASSUMED_JUDGE_INPUT = 1_500
const ASSUMED_JUDGE_OUTPUT = 800

/** Past calls of a kind count only from this many, so that one call is not a forecast. */
const ENOUGH_CALLS = 5

/** A guess until a pilot replaces it: one search of Claude's own in two agentic answers. */
const ASSUMED_SEARCHES_PER_ANSWER = 0.5

export interface CostLine {
  calls: number
  /** Calls the cache already holds, which cost nothing. */
  cached: number
  inputTokens: number
  outputTokens: number
  usd: number
}

/** Row 6's answers, which take a step per search and write their prefix to the cache (ADR-0019). */
export interface AgentCostLine extends CostLine {
  /** Searches of Claude's own per answer, which the estimate assumes. */
  searchesPerAnswer: number
  /** Whether that is a guess, because too few runs have been made yet. */
  assumedSearches: boolean
  /** What the same answers would cost if each used every search it may make. */
  upToUsd: number
}

export interface EvalCostEstimate {
  answers: CostLine
  /** Row 6's answers, when the run has that row. */
  agent?: AgentCostLine
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

/** The free count of each job's first request, in order. Row 6's counts its tool too. */
async function inputTokensEach(jobs: readonly AnswerJob[], client: EvalClient): Promise<number[]> {
  const counts: number[] = []
  for (let i = 0; i < jobs.length; i += COUNTS_AT_ONCE) {
    counts.push(
      ...(await Promise.all(
        jobs.slice(i, i + COUNTS_AT_ONCE).map(async ({ request }) => {
          const { model, system, messages, tools, tool_choice: toolChoice } = request
          const { output_config: outputConfig } = request
          const { input_tokens: tokens } = await client.messages.countTokens({
            model,
            ...(system === undefined ? {} : { system }),
            messages,
            ...(outputConfig === undefined ? {} : { output_config: outputConfig }),
            ...(tools === undefined ? {} : { tools }),
            ...(toolChoice === undefined ? {} : { tool_choice: toolChoice }),
          })
          return tokens
        }),
      )),
    )
  }
  return counts
}

const sumOf = (values: readonly number[]): number =>
  values.reduce((total, value) => total + value, 0)

/**
 * One agentic answer whose first request counts `prefix` tokens and that searches `searches`
 * times, each search's results about the size of the first ones: the first step writes the
 * prefix, search i reads the i prefixes before it and writes its own results, and every step
 * writes `output` tokens.
 */
export function agentAnswerUsd(
  price: ModelPrice | undefined,
  prefix: number,
  searches: number,
  output: number,
): number {
  if (price?.output === undefined) throw new Error('no price for a model the run would call')
  const write = price.cacheWrite5m ?? price.input
  const read = price.cacheRead ?? price.input
  const written = prefix * (1 + searches)
  const readTokens = (prefix * searches * (searches + 1)) / 2
  return (written * write + readTokens * read + (1 + searches) * output * price.output) / 1_000_000
}

export interface EstimateOptions {
  jobs: readonly AnswerJob[]
  client: EvalClient
  cache: EvalCache
  pricing: PricingSettings
  answerModel: string
  judge: JudgeSettings
  /** A second opinion on row 3's first answers. */
  retest: boolean
  /** What row 6's runs are kept under. Needed when a job is of row 6. */
  agent?: AgentRunScope | undefined
}

/** What the run would pay. It calls count_tokens, which is free, and nothing else. */
export async function estimateCost(options: EstimateOptions): Promise<EvalCostEstimate> {
  const { jobs: all, client, cache, pricing, answerModel, judge: judgeSettings, retest } = options
  const scope = options.agent
  const jobs = all.filter((job) => job.row !== AGENT_ROW)
  const agentJobs = all.filter((job) => job.row === AGENT_ROW)
  if (agentJobs.length > 0 && scope === undefined) {
    throw new Error('row 6 needs its limit of searches and what decides them, for the estimate')
  }
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

  const answerInput = sumOf(await inputTokensEach(missing, client))
  const answerOutput = missing.length * outputPerAnswer
  const answers: CostLine = {
    calls: jobs.length,
    cached: jobs.length - missing.length,
    inputTokens: answerInput,
    outputTokens: answerOutput,
    usd: priced(pricing.models[answerModel], answerInput, answerOutput),
  }

  // An answer in the cache says exactly what the judge will be asked, and whether that is
  // cached too. A new answer can only be counted: a verdict, a support check if it may cite,
  // and a second opinion. Identical requests are one call.
  const agent =
    agentJobs.length === 0 || scope === undefined
      ? undefined
      : await agentLine(agentJobs, scope, options, enough)

  const known = new Set<string>()
  let knownCached = 0
  let unknown = 0
  for (const job of all) {
    const answer = cachedAnswer(job, cache, pricing, scope)
    if (answer === undefined) {
      unknown +=
        1 +
        (job.row !== 0 && !isUnanswerable(job.question) ? 1 : 0) +
        (retest && job.row === 3 && job.sample === 1 ? 1 : 0)
    } else if (answer.status === 'ok') {
      for (const { key } of judgeCallsOf(answer, job.question, judgeSettings, retest)) {
        if (known.has(key)) continue
        known.add(key)
        if (cache.has(key)) knownCached++
      }
    }
  }
  const toMake = unknown + known.size - knownCached
  const judgeInput = toMake * inputPerJudge
  const judgeOutput = toMake * outputPerJudge
  const judge: CostLine = {
    calls: unknown + known.size,
    cached: knownCached,
    inputTokens: judgeInput,
    outputTokens: judgeOutput,
    usd: priced(pricing.models[judgeSettings.model], judgeInput, judgeOutput),
  }
  return {
    answers,
    ...(agent === undefined ? {} : { agent }),
    judge,
    usd: answers.usd + (agent?.usd ?? 0) + judge.usd,
    assumed: !enough(answerStats.calls) || !enough(judgeStats.calls),
    pricesChecked: pricing.checked,
  }
}

/** Row 6's line: past runs say how often Claude searched and how long each step's output was. */
async function agentLine(
  jobs: readonly AnswerJob[],
  scope: AgentRunScope,
  options: EstimateOptions,
  enough: (calls: number) => boolean,
): Promise<AgentCostLine> {
  const { cache, client, pricing, answerModel } = options
  const { maxSearches } = scope
  const missing = jobs.filter((job) => !cache.has(agentRunKey(job, scope)))
  const first = cache.stats('agent-first')
  const later = cache.stats('agent-step')
  const measured = enough(first.calls)
  const searches = measured ? later.calls / first.calls : ASSUMED_SEARCHES_PER_ANSWER
  const output = measured
    ? (first.meanOutputTokens * first.calls + later.meanOutputTokens * later.calls) /
      (first.calls + later.calls)
    : ASSUMED_ANSWER_OUTPUT
  const prefixes = await inputTokensEach(missing, client)
  const price = pricing.models[answerModel]
  return {
    calls: jobs.length,
    cached: jobs.length - missing.length,
    // Every input token of every step: each prefix written once, and read by the steps after it.
    inputTokens: sumOf(
      prefixes.map((prefix) => prefix * (1 + searches) + (prefix * searches * (searches + 1)) / 2),
    ),
    outputTokens: missing.length * (1 + searches) * output,
    usd: sumOf(prefixes.map((prefix) => agentAnswerUsd(price, prefix, searches, output))),
    searchesPerAnswer: searches,
    assumedSearches: !measured,
    upToUsd: sumOf(prefixes.map((prefix) => agentAnswerUsd(price, prefix, maxSearches, output))),
  }
}
