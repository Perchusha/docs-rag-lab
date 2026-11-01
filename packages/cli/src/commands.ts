// drl sync | ask | limits. Each command records its API usage in the shared
// meter; run() prints the usage line afterwards, also when a command fails.
import { join } from 'node:path'

import type { Strategy } from '@docs-rag-lab/contracts'
import {
  buildAnswerRequest,
  CitationNumbering,
  createClaudeClient,
  createEmbeddingProvider,
  openIndexes,
  RateLimiter,
  retrieve,
  streamAnswer,
  syncSource,
  type DocType,
  type DrlConfig,
  type Retrieval,
  type UsageMeter,
} from '@docs-rag-lab/core'

import { CliError, requireKey } from './env.ts'
import {
  formatCitations,
  formatDuration,
  formatEmbedProgress,
  formatEstimateRatio,
  formatSyncReport,
  formatTrace,
} from './format.ts'

export interface Writer {
  write(text: string): unknown
}

export interface CommandContext {
  config: DrlConfig
  root: string
  meter: UsageMeter
  out: Writer
  now: () => number
}

// Progress lines during a long sync: at most one every this many milliseconds.
const PROGRESS_INTERVAL_MS = 20_000

type Source = DrlConfig['sources'][number]

function findSource(config: DrlConfig, id: string): Source {
  const source = config.sources.find((s) => s.id === id)
  if (source === undefined) {
    const known = config.sources.map((s) => s.id).join(', ')
    throw new CliError(`unknown source "${id}" (configured: ${known})`)
  }
  return source
}

function embeddingsFor(config: DrlConfig) {
  const provider = createEmbeddingProvider(config.embeddings, {
    voyage: requireKey('VOYAGE_API_KEY'),
  })
  const limiter = new RateLimiter(config.embeddings.rateLimit)
  return { provider, limiter }
}

export async function syncCommand(
  ctx: CommandContext,
  args: { source: string; full: boolean },
): Promise<void> {
  const { config, out } = ctx
  const source = findSource(config, args.source)
  const { provider, limiter } = embeddingsFor(config)
  const start = ctx.now()
  let lastProgress = 0
  const indexes = openIndexes(join(ctx.root, config.dataDir), source.id)
  const { index, cache } = indexes
  try {
    const report = await syncSource({
      source,
      provider,
      index,
      cache,
      checkoutDir: join(ctx.root, config.cacheDir, 'sources', source.id),
      meter: ctx.meter,
      limiter,
      full: args.full,
      onProgress: (event) => {
        const elapsed = ctx.now() - start
        if (event.phase === 'git') out.write(`${event.message}\n`)
        else if (event.phase === 'parse') {
          const why = event.reason === undefined ? '' : ` (${event.reason})`
          out.write(`parsing ${String(event.files)} files, ${event.mode} sync${why}\n`)
        } else if (event.phase === 'embed') {
          const { embedded, toEmbed } = event.progress
          if (embedded === toEmbed || ctx.now() - lastProgress >= PROGRESS_INTERVAL_MS) {
            lastProgress = ctx.now()
            out.write(`${formatEmbedProgress(event.progress, elapsed)}\n`)
          }
        } else out.write(`writing the index (${formatDuration(elapsed)} elapsed)\n`)
      },
    })
    out.write(`\n${formatSyncReport(report, ctx.now() - start, limiter.waitedMs)}\n`)
    const billed = ctx.meter.entries().find(([model]) => model === provider.model)?.[1].inputTokens
    const ratio = formatEstimateRatio(billed ?? 0, report.estimatedTokens)
    if (ratio !== undefined) out.write(`${ratio}\n`)
  } finally {
    indexes.close()
  }
}

export interface RetrievalArgs {
  question: string
  source: string
  topK: number
  strategy: Strategy
  docTypes: DocType[]
}

/** Retrieves for a question with the config's settings and the command-line overrides. */
async function retrieveFor(ctx: CommandContext, args: RetrievalArgs): Promise<Retrieval> {
  const { config } = ctx
  const source = findSource(config, args.source)
  const { provider, limiter } = embeddingsFor(config)
  const indexes = openIndexes(join(ctx.root, config.dataDir), source.id)
  try {
    return await retrieve({
      question: args.question,
      source,
      settings: { ...config.retrieval, strategy: args.strategy, topK: args.topK },
      docTypes: args.docTypes,
      provider,
      index: indexes.index,
      cache: indexes.cache,
      meter: ctx.meter,
      limiter,
    })
  } finally {
    indexes.close()
  }
}

/** `drl search`: retrieval only, no answer. Prints the trace, as text or JSON. */
export async function searchCommand(
  ctx: CommandContext,
  args: RetrievalArgs & { json: boolean },
): Promise<void> {
  const { trace } = await retrieveFor(ctx, args)
  ctx.out.write(args.json ? `${JSON.stringify(trace, null, 2)}\n` : `${formatTrace(trace)}\n`)
}

export async function askCommand(
  ctx: CommandContext,
  args: RetrievalArgs & { verbose: boolean },
): Promise<void> {
  const { config, out } = ctx
  const anthropicKey = requireKey('ANTHROPIC_API_KEY')
  const { hits, trace } = await retrieveFor(ctx, args)
  if (args.verbose) out.write(`${formatTrace(trace)}\n\n`)
  if (hits.length === 0) {
    out.write('No indexed chunks to answer from.\n')
    return
  }

  const model = config.models.answer
  const request = buildAnswerRequest({
    question: args.question,
    hits,
    model,
    effort: config.answer.effort,
    maxTokens: config.answer.maxTokens,
  })
  const numbering = new CitationNumbering()
  const message = await streamAnswer(createClaudeClient(anthropicKey), request, {
    onText: (delta) => out.write(delta),
    onTextBlock: (block) => {
      const numbers = numbering.add(block)
      if (numbers.length > 0) out.write(numbers.map((n) => `[${String(n)}]`).join(''))
    },
    // Also called when the stream fails part-way, so those tokens are reported.
    onUsage: (usage) => {
      ctx.meter.recordMessage(model, usage)
    },
  })
  if (message.stop_reason === 'max_tokens')
    out.write('\n\n(The answer hit max_tokens and is cut off.)')
  if (message.stop_reason === 'refusal') out.write('\n\n(Claude declined to answer.)')
  out.write(`\n\n${formatCitations(numbering.list())}\n`)
}

export async function limitsCommand(ctx: CommandContext): Promise<void> {
  const { config, out } = ctx
  const { provider } = embeddingsFor(config)
  if (provider.probeRateLimits === undefined) {
    throw new CliError(`${provider.id} cannot report rate limits`)
  }
  const probe = await provider.probeRateLimits()
  ctx.meter.recordEmbedding(provider.model, probe.tokens)
  const { rpm, tpm } = config.embeddings.rateLimit
  out.write(
    `configured: ${String(rpm)} requests and ${tpm.toLocaleString('en-US')} tokens per minute\n`,
  )
  const entries = Object.entries(probe.headers)
  if (entries.length === 0) out.write(`${config.embeddings.endpoint} sent no rate-limit headers.\n`)
  else for (const [name, value] of entries) out.write(`${name}: ${value}\n`)
}
