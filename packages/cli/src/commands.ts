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
  type Retrieval,
  type Source,
  type UsageMeter,
} from '@docs-rag-lab/core'
import type { Settings } from '@docs-rag-lab/settings'

import { CliError } from './errors.ts'
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
  settings: Settings
  /** The configured sources, built from settings; the first is the default. */
  sources: readonly Source[]
  root: string
  meter: UsageMeter
  out: Writer
  now: () => number
}

// Progress lines during a long sync: at most one every this many milliseconds.
const PROGRESS_INTERVAL_MS = 20_000

function findSource(sources: readonly Source[], id: string): Source {
  const source = sources.find((s) => s.id === id)
  if (source === undefined) {
    const known = sources.map((s) => s.id).join(', ')
    throw new CliError(`unknown source "${id}" (configured: ${known})`)
  }
  return source
}

/** The provider reads VOYAGE_API_KEY itself, when it is created (ADR-0007). */
function embeddingsFor(settings: Settings) {
  const provider = createEmbeddingProvider(settings.embeddings)
  const limiter = new RateLimiter(settings.embeddings.rateLimit)
  return { provider, limiter }
}

export async function syncCommand(
  ctx: CommandContext,
  args: { source: string; full: boolean },
): Promise<void> {
  const { settings, out } = ctx
  const source = findSource(ctx.sources, args.source)
  const { provider, limiter } = embeddingsFor(settings)
  const start = ctx.now()
  let lastProgress = 0
  const indexes = openIndexes(join(ctx.root, settings.dataDir), source.id)
  const { index, cache } = indexes
  try {
    const report = await syncSource({
      source,
      provider,
      index,
      cache,
      checkoutDir: join(ctx.root, settings.cacheDir, 'sources', source.id),
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

/** Retrieves for a question with the retrieval settings and the command-line overrides. */
async function retrieveFor(ctx: CommandContext, args: RetrievalArgs): Promise<Retrieval> {
  const { settings } = ctx
  const source = findSource(ctx.sources, args.source)
  const { provider, limiter } = embeddingsFor(settings)
  const indexes = openIndexes(join(ctx.root, settings.dataDir), source.id)
  try {
    return await retrieve({
      question: args.question,
      source,
      settings: { ...settings.retrieval, strategy: args.strategy, topK: args.topK },
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
  const { settings, out } = ctx
  // Before retrieval, so a missing ANTHROPIC_API_KEY fails before any Voyage call.
  const client = createClaudeClient()
  const { hits, trace } = await retrieveFor(ctx, args)
  if (args.verbose) out.write(`${formatTrace(trace)}\n\n`)
  if (hits.length === 0) {
    out.write('No indexed chunks to answer from.\n')
    return
  }

  const model = settings.models.answer
  const request = buildAnswerRequest({
    question: args.question,
    hits,
    model,
    effort: settings.answer.effort,
    maxTokens: settings.answer.maxTokens,
  })
  const numbering = new CitationNumbering()
  const message = await streamAnswer(client, request, {
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
  const { settings, out } = ctx
  const { provider } = embeddingsFor(settings)
  if (provider.probeRateLimits === undefined) {
    throw new CliError(`${provider.id} cannot report rate limits`)
  }
  const probe = await provider.probeRateLimits()
  ctx.meter.recordEmbedding(provider.model, probe.tokens)
  const { rpm, tpm } = settings.embeddings.rateLimit
  out.write(
    `configured: ${String(rpm)} requests and ${tpm.toLocaleString('en-US')} tokens per minute\n`,
  )
  const entries = Object.entries(probe.headers)
  if (entries.length === 0)
    out.write(`${settings.embeddings.endpoint} sent no rate-limit headers.\n`)
  else for (const [name, value] of entries) out.write(`${name}: ${value}\n`)
}
