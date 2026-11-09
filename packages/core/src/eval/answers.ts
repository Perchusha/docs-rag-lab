// Answers and verdicts for the golden set (SPEC section 10, ADR-0012). Every call is cached
// by its whole request as soon as it returns, so a run that stops loses nothing and a rerun
// does not pay twice. Only on request, with the estimate printed first.
import { createHash } from 'node:crypto'

import type Anthropic from '@anthropic-ai/sdk'
import type {
  AnswerRow,
  AnswerStatus,
  EvalAgentSearch,
  EvalAgentStep,
  EvalAnswer,
  EvalClaim,
  EvalSupport,
  EvalVerdict,
  Strategy,
} from '@docs-rag-lab/contracts'
import type { EvalCache, SearchHit } from '@docs-rag-lab/db'
import type { Effort, PricingSettings } from '@docs-rag-lab/settings'

import { buildAgentRequest, runAgentLoop, type AgentSearchFn } from '../agent.ts'
import type { Engine } from '../engine.ts'
import type { IndexVariant } from '../indexes.ts'
import { buildAnswerRequest, streamAnswer, type AnswerClient } from '../generate.ts'
import type { RunGuard } from '../run-guard.ts'
import { UsageMeter } from '../usage.ts'
import type { GoldenQuestion } from './golden.ts'
import {
  correctnessRequest,
  isUnanswerable,
  parseCorrectness,
  parseRefusal,
  parseSupport,
  refusalRequest,
  supportRequest,
  type JudgeSettings,
} from './judge.ts'

/** The strategy behind a row. Row 0 retrieves nothing. */
export const ROW_STRATEGY: Partial<Record<AnswerRow, Strategy>> = {
  2: 'vector',
  3: 'hybrid',
  4: 'rerank',
  5: 'rerank',
  6: 'hybrid',
  7: 'hybrid',
}

/** The index behind a row, when it is not the plain one (ADR-0014, ADR-0017). */
export const ROW_VARIANT: Partial<Record<AnswerRow, IndexVariant>> = {
  5: 'contextual',
  7: 'compiled',
}

/** The rows a noise run answers twice: row 3, and the rows measured against it. */
export const NOISE_ROWS: readonly AnswerRow[] = [3, 4, 5, 6, 7]

/** Agentic mode (ADR-0019): row 3's search, then Claude may search again. */
export const AGENT_ROW: AnswerRow = 6

/**
 * Bumped when the loop changes what a step sends or records, so that a stored run of the loop is
 * not read as one of this code (ADR-0019).
 */
export const AGENT_LOOP_VERSION = 1

/**
 * A second answer's first request is its first answer's, so the second answers start after every
 * cache entry of the first answers has expired: 6 minutes, past the 5 of the cache (ADR-0019).
 */
export const SECOND_ANSWERS_WAIT_MS = 6 * 60_000

/** Row 0: Claude without RAG. It is told it has no docs, and to say so rather than guess. */
export function noRagSystemPrompt(sourceId: string): string {
  return [
    `You answer questions about the ${sourceId} documentation from memory: you have no access to the documentation itself.`,
    'If the documentation would not cover the question, or you are not sure that what it asks about exists, say so plainly instead of guessing.',
    'Keep the answer short and direct.',
  ].join(' ')
}

export interface AnswerSettings {
  model: string
  effort: Effort
  maxTokens: number
}

export function rowRequest(
  row: AnswerRow,
  sourceId: string,
  question: string,
  hits: readonly SearchHit[],
  settings: AnswerSettings,
  /** Row 6's tool offers the doc types the source's index holds. */
  docTypes?: readonly string[],
): Anthropic.MessageCreateParamsNonStreaming {
  if (row === AGENT_ROW) {
    if (docTypes === undefined) throw new Error('row 6 needs the doc types of the index')
    return buildAgentRequest({ question, hits, ...settings, docTypes })
  }
  if (row !== 0) return buildAnswerRequest({ question, hits, ...settings })
  return {
    model: settings.model,
    max_tokens: settings.maxTokens,
    system: noRagSystemPrompt(sourceId),
    output_config: { effort: settings.effort },
    messages: [{ role: 'user', content: [{ type: 'text', text: question }] }],
  }
}

/** Any change to the question, context, model, settings or prompt is another request. */
export function requestKey(
  request: Anthropic.MessageCreateParamsNonStreaming,
  sample: number,
): string {
  return createHash('sha256')
    .update(JSON.stringify([sample, request]))
    .digest('hex')
}

export function promptHash(prompt: string): string {
  return createHash('sha256').update(prompt).digest('hex').slice(0, 12)
}

/** The client eval needs: the answer stream, and the free token count for the estimate. */
export interface EvalClient extends AnswerClient {
  messages: AnswerClient['messages'] & {
    countTokens(params: {
      model: string
      system?: Anthropic.MessageCreateParamsNonStreaming['system']
      messages: Anthropic.MessageParam[]
      output_config?: Anthropic.MessageCreateParamsNonStreaming['output_config']
      tools?: Anthropic.MessageCountTokensTool[]
      tool_choice?: Anthropic.ToolChoice
    }): PromiseLike<{ input_tokens: number }>
  }
}

interface CachedCall {
  message: Anthropic.Message
  latencyMs: number
  firstTokenMs: number | null
}

export interface AnswerJob {
  question: GoldenQuestion
  row: AnswerRow
  sample: number
  hits: readonly SearchHit[]
  request: Anthropic.MessageCreateParamsNonStreaming
  key: string
}

export interface PlanOptions {
  engine: Engine
  /** The engine of another index. Needed only by the rows that read one. */
  engineFor?: ((variant: IndexVariant) => Engine) | undefined
  sourceId: string
  questions: readonly GoldenQuestion[]
  rows: readonly AnswerRow[]
  /** Answer the noise rows again and take a second opinion, to measure answers and judge. */
  noise: boolean
  settings: AnswerSettings
  meter: UsageMeter
}

/** Retrieval for every job, and the request each will send. No Claude call. */
export async function planAnswers(options: PlanOptions): Promise<AnswerJob[]> {
  const { engine, sourceId, questions, rows, noise, settings, meter } = options
  // One request instead of one per question, as the retrieval half does (ADR-0010).
  if (rows.some((row) => ROW_STRATEGY[row] !== undefined)) {
    await engine.embedQueries(
      { source: sourceId, questions: questions.map((question) => question.question) },
      meter,
    )
  }
  const jobs: AnswerJob[] = []
  for (const row of rows) {
    const strategy = ROW_STRATEGY[row]
    const variant = ROW_VARIANT[row]
    const rowEngine = variant === undefined ? engine : options.engineFor?.(variant)
    if (rowEngine === undefined) throw new Error(`row ${String(row)} needs another index`)
    const docTypes = row === AGENT_ROW ? rowEngine.docTypes(sourceId) : undefined
    for (const question of questions) {
      const hits =
        strategy === undefined
          ? []
          : (
              await rowEngine.search(
                { question: question.question, source: sourceId, strategy },
                meter,
              )
            ).hits
      const request = rowRequest(row, sourceId, question.question, hits, settings, docTypes)
      const samples = noise && NOISE_ROWS.includes(row) ? [1, 2] : [1]
      for (const sample of samples) {
        jobs.push({ question, row, sample, hits, request, key: requestKey(request, sample) })
      }
    }
  }
  return jobs
}

/** Too many in a row means the key, the network or the account, not one bad request. */
const MAX_FAILURES_IN_A_ROW = 5

export class EvalStoppedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EvalStoppedError'
  }
}

export interface RunnerOptions {
  client: EvalClient
  cache: EvalCache
  pricing: PricingSettings
  /** All paid calls of this run go on this meter. */
  meter: UsageMeter
  /** Stops before the next paid call once the run has spent this much. */
  maxUsd: number
  concurrency: number
  /** Checked before each paid call. A cached reply pays nothing, and needs no check. */
  guard?: RunGuard | undefined
  now?: () => number
  onProgress?: (done: number, total: number, paidUsd: number) => void
}

/** One message priced at list prices. */
function costOf(message: Anthropic.Message, pricing: PricingSettings): number {
  const meter = new UsageMeter()
  meter.recordMessage(message.model, message.usage)
  return meter.estimateCost(pricing).total
}

/** Runs work with a limited number at once, and stops starting more once told to. */
export async function forEachLimit<T>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<void>,
  stopped: () => boolean,
): Promise<void> {
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length && !stopped()) {
      const item = items[next++]
      if (item !== undefined) await work(item)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

/** Throws when a reply cannot be used. It then stays out of the cache, so a rerun tries again. */
type ReplyCheck = (message: Anthropic.Message) => void

export class Runner {
  readonly #options: RunnerOptions
  /** Identical requests at once get one call, so that one text cannot get two grades. */
  readonly #inFlight = new Map<string, Promise<CachedCall>>()
  #failuresInARow = 0
  #stop: string | undefined

  constructor(options: RunnerOptions) {
    this.#options = options
  }

  get stopped(): boolean {
    return this.#stop !== undefined
  }

  /** Throws when the run stopped early. What it paid for is in the cache. */
  check(): void {
    if (this.#stop !== undefined) throw new EvalStoppedError(this.#stop)
  }

  paidUsd(): number {
    return this.#options.meter.estimateCost(this.#options.pricing).total
  }

  /** The message for a request, from the cache or from Claude. fromCache: this one paid nothing. */
  async call(
    kind: string,
    request: Anthropic.MessageCreateParamsNonStreaming,
    key: string,
    check: ReplyCheck = () => undefined,
  ): Promise<{ call: CachedCall; fromCache: boolean }> {
    const { cache, maxUsd } = this.#options
    const cached = cache.get(key) as CachedCall | undefined
    if (cached !== undefined) return { call: cached, fromCache: true }
    const running = this.#inFlight.get(key)
    if (running !== undefined) return { call: await running, fromCache: true }
    if (this.paidUsd() >= maxUsd) {
      this.#stop = `stopped at the limit of $${maxUsd.toFixed(2)}: what was paid for is cached, so a rerun continues from here`
      throw new EvalStoppedError(this.#stop)
    }
    const paid = this.#paidCall(kind, request, key, check).finally(() => {
      this.#inFlight.delete(key)
    })
    this.#inFlight.set(key, paid)
    return { call: await paid, fromCache: false }
  }

  async #paidCall(
    kind: string,
    request: Anthropic.MessageCreateParamsNonStreaming,
    key: string,
    check: ReplyCheck,
  ): Promise<CachedCall> {
    const { cache, client, meter, guard } = this.#options
    try {
      await guard?.check()
    } catch (error) {
      this.#stop = error instanceof Error ? error.message : String(error)
      throw new EvalStoppedError(this.#stop)
    }
    const now = this.#options.now ?? (() => performance.now())
    const start = now()
    let firstTokenMs: number | null = null
    let message: Anthropic.Message
    try {
      message = await streamAnswer(client, request, {
        onText: () => {
          firstTokenMs ??= now() - start
        },
        onUsage: (usage) => {
          meter.recordMessage(request.model, usage)
        },
      })
      // A fallback or an alias would measure another model than the report says.
      if (message.model !== request.model) {
        throw new Error(`${message.model} answered, and ${request.model} was asked for`)
      }
      check(message)
    } catch (error) {
      this.#failed()
      throw error
    }
    this.#failuresInARow = 0
    const call: CachedCall = { message, latencyMs: now() - start, firstTokenMs }
    cache.put(key, kind, {
      value: call,
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
    })
    return call
  }

  #failed(): void {
    this.#failuresInARow++
    if (this.#failuresInARow >= MAX_FAILURES_IN_A_ROW) {
      this.#stop = `stopped after ${String(MAX_FAILURES_IN_A_ROW)} failures in a row`
    }
  }

  run<T>(items: readonly T[], work: (item: T) => Promise<void>): Promise<void> {
    const { concurrency, onProgress } = this.#options
    let done = 0
    return forEachLimit(
      items,
      concurrency,
      async (item) => {
        await work(item)
        done++
        onProgress?.(done, items.length, this.paidUsd())
      },
      () => this.stopped,
    )
  }

  get pricing(): PricingSettings {
    return this.#options.pricing
  }

  get cache(): EvalCache {
    return this.#options.cache
  }

  get now(): () => number {
    return this.#options.now ?? (() => performance.now())
  }
}

const textOf = (message: Pick<Anthropic.Message, 'content'>): string =>
  message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('')

/** An answer that finished with nothing to read, or stopped for a reason of no meaning here. */
const checkAnswer: ReplyCheck = (message) => {
  const stop = message.stop_reason
  if (stop === 'max_tokens' || stop === 'refusal') return
  if (stop !== 'end_turn') throw new Error(`it stopped with ${String(stop)}`)
  if (textOf(message).trim() === '') throw new Error('the answer is empty')
}

function statusOf(message: Anthropic.Message): AnswerStatus {
  if (message.stop_reason === 'max_tokens') return 'truncated'
  if (message.stop_reason === 'refusal') return 'refused'
  return 'ok'
}

/** Every text block with citations, keeping all of them. */
export function claimsOf(
  message: Pick<Anthropic.Message, 'content'>,
  hits: readonly Pick<SearchHit, 'chunkId'>[],
): EvalClaim[] {
  return message.content.flatMap((block) => {
    if (block.type !== 'text') return []
    const citations = (block.citations ?? []).flatMap((citation) => {
      if (citation.type !== 'search_result_location') return []
      const chunk = hits[citation.search_result_index]
      if (chunk === undefined) {
        throw new Error(
          `a citation points to search result ${String(citation.search_result_index)}, and the context has ${String(hits.length)}`,
        )
      }
      return [{ chunkId: chunk.chunkId, citedText: citation.cited_text }]
    })
    return citations.length === 0 ? [] : [{ text: block.text, citations }]
  })
}

function answerOf(
  job: AnswerJob,
  call: CachedCall,
  fromCache: boolean,
  pricing: PricingSettings,
): EvalAnswer {
  const { message } = call
  return {
    questionId: job.question.id,
    row: job.row,
    sample: job.sample,
    status: statusOf(message),
    model: message.model,
    stopReason: message.stop_reason,
    text: textOf(message),
    blocks: message.content.filter((block) => block.type === 'text'),
    claims: claimsOf(message, job.hits),
    context: job.hits.map((hit) => hit.chunkId),
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    costUsd: costOf(message, pricing),
    latencyMs: call.latencyMs,
    firstTokenMs: call.firstTokenMs,
    fromCache,
  }
}

/** The answer in the cache for a job, if there is one. It costs nothing to read. */
export function cachedAnswer(
  job: AnswerJob,
  cache: EvalCache,
  pricing: PricingSettings,
  /** Row 6's limit, under which its runs are kept. */
  maxSearches?: number,
): EvalAnswer | undefined {
  if (job.row === AGENT_ROW) {
    if (maxSearches === undefined) return undefined
    const run = cache.get(agentRunKey(job, maxSearches)) as CachedAgentRun | undefined
    return run === undefined ? undefined : agentAnswerOf(job, run, true, pricing)
  }
  const cached = cache.get(job.key) as CachedCall | undefined
  return cached === undefined ? undefined : answerOf(job, cached, true, pricing)
}

/**
 * A finished run of the loop (ADR-0019): what its answer needs, timed with its searches. Each step
 * is cached too, by its own request, so a run that stopped part-way pays only for the rest.
 */
interface CachedAgentRun {
  message: Anthropic.Message
  context: string[]
  searches: EvalAgentSearch[]
  steps: EvalAgentStep[]
  latencyMs: number
  firstTokenMs: number | null
  failure?: string
}

/** Where a run of the loop is kept: by its first request, the loop's version and its limit. */
export function agentRunKey(job: Pick<AnswerJob, 'key'>, maxSearches: number): string {
  return createHash('sha256')
    .update(JSON.stringify(['agent-run', AGENT_LOOP_VERSION, maxSearches, job.key]))
    .digest('hex')
}

function stepOf(message: Anthropic.Message): EvalAgentStep {
  const { usage } = message
  return {
    stopReason: message.stop_reason,
    inputTokens: usage.input_tokens,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    outputTokens: usage.output_tokens,
  }
}

const sumOf = <T>(items: readonly T[], value: (item: T) => number): number =>
  items.reduce((total, item) => total + value(item), 0)

/**
 * An agentic answer. Its input counts every input token of every step, cached or not, so that it
 * reads beside the other rows. Its cost prices writes and reads as they were billed, and
 * `uncachedCostUsd` prices the same tokens at the input price.
 */
function agentAnswerOf(
  job: AnswerJob,
  run: CachedAgentRun,
  fromCache: boolean,
  pricing: PricingSettings,
): EvalAnswer {
  const { message, steps } = run
  const billed = new UsageMeter()
  for (const step of steps) {
    billed.recordMessage(message.model, {
      input_tokens: step.inputTokens,
      output_tokens: step.outputTokens,
      cache_creation_input_tokens: step.cacheWriteTokens,
      cache_read_input_tokens: step.cacheReadTokens,
    })
  }
  const inputTokens = sumOf(
    steps,
    (step) => step.inputTokens + step.cacheWriteTokens + step.cacheReadTokens,
  )
  const outputTokens = sumOf(steps, (step) => step.outputTokens)
  const plain = new UsageMeter()
  plain.recordMessage(message.model, { input_tokens: inputTokens, output_tokens: outputTokens })
  return {
    questionId: job.question.id,
    row: job.row,
    sample: job.sample,
    status: run.failure === undefined ? statusOf(message) : 'failed',
    ...(run.failure === undefined ? {} : { error: run.failure }),
    model: message.model,
    stopReason: message.stop_reason,
    text: textOf(message),
    blocks: message.content.filter((block) => block.type === 'text'),
    claims: claimsOf(
      message,
      run.context.map((chunkId) => ({ chunkId })),
    ),
    context: run.context,
    inputTokens,
    outputTokens,
    costUsd: billed.estimateCost(pricing).total,
    latencyMs: run.latencyMs,
    firstTokenMs: run.firstTokenMs,
    fromCache,
    steps,
    searches: run.searches,
    uncachedCostUsd: plain.estimateCost(pricing).total,
  }
}

/** A step may stop for its tool. Otherwise it is held to what any answer is. */
const checkStep: ReplyCheck = (message) => {
  if (message.stop_reason !== 'tool_use') checkAnswer(message)
}

export interface AgentEvalOptions {
  maxSearches: number
  /** The doc types the source's index holds, which the tool offers. */
  docTypes: readonly string[]
  /** Hybrid on the plain index, for a query of Claude's own. */
  search: AgentSearchFn
  /** Waits before the second answers. Tests pass their own. */
  sleep?: (ms: number) => Promise<void>
  /** Told of that wait before it starts. */
  onWait?: (ms: number) => void
}

/** One agentic answer: from its stored run, or step by step, each step from the cache or paid. */
async function runAgentAnswer(
  job: AnswerJob,
  runner: Runner,
  agent: AgentEvalOptions,
): Promise<EvalAnswer> {
  const { cache, pricing, now } = runner
  const recordKey = agentRunKey(job, agent.maxSearches)
  const stored = cache.get(recordKey) as CachedAgentRun | undefined
  if (stored !== undefined) return agentAnswerOf(job, stored, true, pricing)
  const start = now()
  const calls: { call: CachedCall; fromCache: boolean; at: number }[] = []
  const loop = await runAgentLoop({
    first: job.request,
    hits: job.hits,
    docTypes: agent.docTypes,
    maxSearches: agent.maxSearches,
    search: agent.search,
    call: async (request, step) => {
      const at = now() - start
      const key = step === 0 ? job.key : requestKey(request, job.sample)
      const kind = step === 0 ? 'agent-first' : 'agent-step'
      const result = await runner.call(kind, request, key, checkStep)
      calls.push({ ...result, at })
      return result.call.message
    },
  })
  const paid = calls.some(({ fromCache }) => !fromCache)
  const last = calls.at(-1)
  const earlier = sumOf(calls.slice(0, -1), ({ call }) => call.latencyMs)
  const firstToken = last?.call.firstTokenMs ?? null
  // A run that paid for a step is timed with its searches. One replayed from cached steps alone,
  // with no run stored, has only the steps' own times.
  const run: CachedAgentRun = {
    message: loop.message,
    context: loop.context.map((hit) => hit.chunkId),
    searches: loop.searches,
    steps: loop.messages.map(stepOf),
    latencyMs: paid ? now() - start : sumOf(calls, ({ call }) => call.latencyMs),
    firstTokenMs: firstToken === null ? null : (paid ? (last?.at ?? 0) : earlier) + firstToken,
    ...(loop.failure === undefined ? {} : { failure: loop.failure }),
  }
  if (paid) cache.put(recordKey, 'agent-run', { value: run, inputTokens: 0, outputTokens: 0 })
  return agentAnswerOf(job, run, !paid, pricing)
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

export interface AnswerRunOptions extends RunnerOptions {
  /** Needed when a job is of row 6. */
  agent?: AgentEvalOptions | undefined
}

const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/** Calls finish in any order, and a report should not depend on that. */
function inOrder<
  T extends { questionId: string; row: number; sample: number; judgeSample?: number },
>(items: T[]): T[] {
  return items.sort(
    (a, b) =>
      a.questionId.localeCompare(b.questionId) ||
      a.row - b.row ||
      a.sample - b.sample ||
      (a.judgeSample ?? 0) - (b.judgeSample ?? 0),
  )
}

/**
 * Answers every job. A failed call is recorded as failed, and is never a score. Row 6's second
 * answers run last, once no cache entry of its first answers can be read (ADR-0019).
 */
export async function runAnswers(
  jobs: readonly AnswerJob[],
  options: AnswerRunOptions,
): Promise<EvalAnswer[]> {
  const { agent } = options
  if (agent === undefined && jobs.some((job) => job.row === AGENT_ROW)) {
    throw new Error('row 6 needs the agent options')
  }
  const runner = new Runner(options)
  const answers: EvalAnswer[] = []
  const work = async (job: AnswerJob): Promise<void> => {
    try {
      if (job.row === AGENT_ROW && agent !== undefined) {
        answers.push(await runAgentAnswer(job, runner, agent))
        return
      }
      const { call, fromCache } = await runner.call('answer', job.request, job.key, checkAnswer)
      answers.push(answerOf(job, call, fromCache, runner.pricing))
    } catch (error) {
      if (error instanceof EvalStoppedError) return
      answers.push({
        questionId: job.question.id,
        row: job.row,
        sample: job.sample,
        status: 'failed',
        error: reasonOf(error),
        model: job.request.model,
        stopReason: null,
        text: '',
        blocks: [],
        claims: [],
        context: job.hits.map((hit) => hit.chunkId),
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        latencyMs: 0,
        firstTokenMs: null,
        fromCache: false,
      })
    }
  }
  const isSecondAgentic = (job: AnswerJob): boolean => job.row === AGENT_ROW && job.sample > 1
  await runner.run(
    jobs.filter((job) => !isSecondAgentic(job)),
    work,
  )
  const later = jobs.filter(isSecondAgentic)
  if (agent !== undefined && later.length > 0 && !runner.stopped) {
    // Only a first request that is not cached here is sent, and only that could read an entry.
    const sends = later.some(
      (job) => !runner.cache.has(job.key) && !runner.cache.has(agentRunKey(job, agent.maxSearches)),
    )
    if (sends) {
      agent.onWait?.(SECOND_ANSWERS_WAIT_MS)
      await (agent.sleep ?? sleep)(SECOND_ANSWERS_WAIT_MS)
    }
    await runner.run(later, work)
  }
  runner.check()
  return inOrder(answers)
}

export interface JudgeResult {
  verdicts: EvalVerdict[]
  support: EvalSupport[]
}

export interface JudgeOptions extends RunnerOptions {
  judge: JudgeSettings
  questions: ReadonlyMap<string, GoldenQuestion>
  /** Ask the judge a second time about row 3's first answers. */
  retest: boolean
}

/** One call the judge has to make about one answer. */
export interface JudgeCall {
  type: 'verdict' | 'support'
  answer: EvalAnswer
  question: GoldenQuestion
  judgeSample: number
  request: Anthropic.MessageCreateParamsNonStreaming
  key: string
}

const isRetested = (answer: EvalAnswer): boolean => answer.row === 3 && answer.sample === 1

/** What the judge is asked about one finished answer. The estimate counts the same calls. */
export function judgeCallsOf(
  answer: EvalAnswer,
  question: GoldenQuestion,
  judge: JudgeSettings,
  retest: boolean,
): JudgeCall[] {
  const unanswerable = isUnanswerable(question)
  const verdict = unanswerable
    ? refusalRequest(judge, question, answer.text, answer.claims)
    : correctnessRequest(judge, question, answer.text)
  const common = { answer, question }
  return [
    ...(retest && isRetested(answer) ? [1, 2] : [1]).map((judgeSample): JudgeCall => ({
      ...common,
      type: 'verdict',
      judgeSample,
      request: verdict,
      key: requestKey(verdict, judgeSample),
    })),
    ...(answer.claims.length === 0 || unanswerable
      ? []
      : [supportRequest(judge, answer.claims)].map((request): JudgeCall => ({
          ...common,
          type: 'support',
          judgeSample: 1,
          request,
          key: requestKey(request, 1),
        }))),
  ]
}

/** Judges every answer that finished. Truncated, refused and failed ones stay out of it. */
export async function runJudge(
  answers: readonly EvalAnswer[],
  options: JudgeOptions,
): Promise<JudgeResult> {
  const runner = new Runner(options)
  const { judge, questions, retest } = options
  const calls = answers
    .filter((answer) => answer.status === 'ok')
    .flatMap((answer) => {
      const question = questions.get(answer.questionId)
      if (question === undefined) throw new Error(`no question ${answer.questionId}`)
      return judgeCallsOf(answer, question, judge, retest)
    })
  const verdicts: EvalVerdict[] = []
  const support: EvalSupport[] = []

  await runner.run(calls, async ({ type, answer, question, judgeSample, request, key }) => {
    const base = { questionId: answer.questionId, row: answer.row, sample: answer.sample }
    if (type === 'support') {
      const count = answer.claims.length
      try {
        const { call } = await runner.call('judge', request, key, (message) => {
          parseSupport(message, count)
        })
        support.push({
          ...base,
          status: 'ok',
          claims: parseSupport(call.message, count),
          costUsd: costOf(call.message, runner.pricing),
        })
      } catch (error) {
        if (error instanceof EvalStoppedError) return
        support.push({ ...base, status: 'failed', error: reasonOf(error), claims: [], costUsd: 0 })
      }
      return
    }
    const unanswerable = isUnanswerable(question)
    try {
      const { call } = await runner.call('judge', request, key, (message) => {
        if (unanswerable) parseRefusal(message)
        else parseCorrectness(message)
      })
      const costUsd = costOf(call.message, runner.pricing)
      if (unanswerable) {
        const { reasoning, outcome } = parseRefusal(call.message)
        verdicts.push({
          ...base,
          judgeSample,
          status: 'ok',
          reasoning,
          correctness: null,
          falseRefusal: null,
          outcome,
          costUsd,
        })
      } else {
        const { reasoning, correctness, falseRefusal } = parseCorrectness(call.message)
        verdicts.push({
          ...base,
          judgeSample,
          status: 'ok',
          reasoning,
          correctness,
          falseRefusal,
          outcome: null,
          costUsd,
        })
      }
    } catch (error) {
      if (error instanceof EvalStoppedError) return
      verdicts.push({
        ...base,
        judgeSample,
        status: 'failed',
        error: reasonOf(error),
        reasoning: '',
        correctness: null,
        falseRefusal: null,
        outcome: null,
        costUsd: 0,
      })
    }
  })
  runner.check()
  return { verdicts: inOrder(verdicts), support: inOrder(support) }
}
