// Answers and verdicts for the golden set (SPEC section 10, ADR-0012). Every call is cached
// by its whole request as soon as it returns, so a run that stops loses nothing and a rerun
// does not pay twice. Only on request, with the estimate printed first.
import { createHash } from 'node:crypto'

import type Anthropic from '@anthropic-ai/sdk'
import type {
  AnswerRow,
  AnswerStatus,
  EvalAnswer,
  EvalClaim,
  EvalSupport,
  EvalVerdict,
  Strategy,
} from '@docs-rag-lab/contracts'
import type { EvalCache, SearchHit } from '@docs-rag-lab/db'
import type { Effort, PricingSettings } from '@docs-rag-lab/settings'

import type { Engine } from '../engine.ts'
import type { IndexVariant } from '../indexes.ts'
import { buildAnswerRequest, streamAnswer, type AnswerClient } from '../generate.ts'
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
}

/** The index behind a row, when it is not the plain one (ADR-0014). */
export const ROW_VARIANT: Partial<Record<AnswerRow, IndexVariant>> = { 5: 'contextual' }

/** The rows a noise run answers twice: row 3, and the rows measured against it. */
export const NOISE_ROWS: readonly AnswerRow[] = [3, 4, 5]

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
): Anthropic.MessageCreateParamsNonStreaming {
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
      const request = rowRequest(row, sourceId, question.question, hits, settings)
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
    const { cache, client, meter } = this.#options
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
): EvalAnswer | undefined {
  const cached = cache.get(job.key) as CachedCall | undefined
  return cached === undefined ? undefined : answerOf(job, cached, true, pricing)
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

/** Answers every job. A failed call is recorded as failed, and is never a score. */
export async function runAnswers(
  jobs: readonly AnswerJob[],
  options: RunnerOptions,
): Promise<EvalAnswer[]> {
  const runner = new Runner(options)
  const answers: EvalAnswer[] = []
  await runner.run(jobs, async (job) => {
    try {
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
  })
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
