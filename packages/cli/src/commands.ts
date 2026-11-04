// drl sync | ask | search | limits | eval check. Each command records its API usage in the
// shared meter; run() prints the usage line afterwards, also when a command
// fails. ask and search go through the engine, the same code path as the apps.
import { join } from 'node:path'

import {
  NO_CONTEXT,
  type Citation,
  type RetrievalRequest,
  type Strategy,
} from '@docs-rag-lab/contracts'
import {
  createEmbeddingProvider,
  createRerankProvider,
  GoldenSetError,
  openIndexes,
  RateLimiter,
  syncSource,
  type AnchorIndex,
  type DocType,
  type Engine,
  type Source,
  type UsageMeter,
  type EvalClient,
} from '@docs-rag-lab/core'
import type { Settings } from '@docs-rag-lab/settings'

import { CliError } from './errors.ts'
import {
  formatCitations,
  formatDuration,
  formatEmbedProgress,
  formatEstimateRatio,
  formatGoldenCheck,
  formatSyncReport,
  formatTrace,
} from './format.ts'
import { checkGoldenFiles, goldenSetPath, writeGoldenLock } from './golden.ts'

export interface Writer {
  write(text: string): unknown
}

export interface CommandContext {
  settings: Settings
  /** The configured sources, built from settings; the first is the default. */
  sources: readonly Source[]
  /** Search and ask, over the same settings and sources. */
  engine: Engine
  root: string
  meter: UsageMeter
  out: Writer
  now: () => number
  /** For tests. Answer metrics default to the Claude client named in settings. */
  createEvalClient?: (() => EvalClient) | undefined
}

// Progress lines during a long sync: at most one every this many milliseconds.
const PROGRESS_INTERVAL_MS = 20_000

export function findSource(sources: readonly Source[], id: string): Source {
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
  args: { source: string; full: boolean; at: string | undefined },
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
      at: args.at,
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
    reportGoldenSet(ctx, source.id, index)
  } finally {
    indexes.close()
  }
}

/**
 * SPEC section 9, step 6: says which golden questions a sync made stale. The
 * sync itself has succeeded by now, so a broken golden set does not fail it.
 */
function reportGoldenSet(ctx: CommandContext, sourceId: string, index: AnchorIndex): void {
  try {
    const check = checkGoldenFiles(ctx.root, sourceId, index)
    if (check !== undefined) ctx.out.write(`\n${formatGoldenCheck(check)}\n`)
  } catch (error) {
    if (!(error instanceof GoldenSetError)) throw error
    ctx.out.write(`\n${error.message}\n`)
  }
}

/** `drl eval check`: the golden set against the index. No API calls. */
export function evalCheckCommand(
  ctx: CommandContext,
  args: { source: string; accept: boolean; setVersion: number | undefined },
): void {
  const { out, root } = ctx
  const source = findSource(ctx.sources, args.source)
  const indexes = openIndexes(join(root, ctx.settings.dataDir), source.id, { create: false })
  try {
    const check = checkGoldenFiles(root, source.id, indexes.index)
    if (check === undefined) {
      throw new CliError(
        `${source.id} has no golden set: ${goldenSetPath(root, source.id)} does not exist`,
      )
    }
    out.write(`${formatGoldenCheck(check)}\n`)
    if (args.accept) {
      const unresolved = check.findings.filter(
        ({ problem }) => problem !== 'changed' && problem !== 'not-locked',
      )
      if (unresolved.length > 0) {
        throw new CliError(
          'anchors that do not resolve cannot be accepted: fix or remove them first',
        )
      }
      const next = check.setVersion + 1
      if (check.setChanged && args.setVersion !== next) {
        throw new CliError(
          `the golden set is frozen: after adding its changelog entry to ADR-0009, accept it with --set-version ${String(next)}`,
        )
      }
      if (!check.setChanged && args.setVersion !== undefined) {
        throw new CliError('--set-version is for a changed set, and this one matches the lock')
      }
      const setVersion = args.setVersion ?? check.setVersion
      writeGoldenLock(root, source.id, { ...check.lock, setVersion })
      out.write(
        `the lock now records set version ${String(setVersion)}, with ${String(check.anchors)} anchors at ${check.docsSha.slice(0, 8)}\n`,
      )
    } else if (check.setChanged) {
      throw new CliError('the golden set is frozen, and the file differs from its lock')
    } else if (check.findings.length > 0 || check.docsMovedFrom !== undefined) {
      throw new CliError(
        'the golden set needs a review: fix what is listed, then record it with drl eval check --accept',
      )
    }
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

function requestOf(args: RetrievalArgs): RetrievalRequest {
  const { question, source, strategy, topK, docTypes } = args
  return { question, source, strategy, topK, docTypes }
}

/** `drl search`: retrieval only, no answer. Prints the trace, as text or JSON. */
export async function searchCommand(
  ctx: CommandContext,
  args: RetrievalArgs & { json: boolean },
): Promise<void> {
  const { trace } = await ctx.engine.search(requestOf(args), ctx.meter)
  ctx.out.write(args.json ? `${JSON.stringify(trace, null, 2)}\n` : `${formatTrace(trace)}\n`)
}

export async function askCommand(
  ctx: CommandContext,
  args: RetrievalArgs & { verbose: boolean },
): Promise<void> {
  const { out } = ctx
  const citations: Citation[] = []
  // The engine records usage in the meter as it goes, also when the stream
  // fails part-way, so run() still reports those tokens.
  await ctx.engine.ask(requestOf(args), {
    meter: ctx.meter,
    onEvent: (event) => {
      if (event.type === 'trace') {
        if (args.verbose) out.write(`${formatTrace(event.trace)}\n\n`)
      } else if (event.type === 'text') {
        out.write(event.text)
      } else if (event.type === 'citations') {
        out.write(event.numbers.map((n) => `[${String(n)}]`).join(''))
        citations.push(...event.citations)
      } else if (event.type === 'done') {
        if (event.stopReason === NO_CONTEXT) {
          out.write('No indexed chunks to answer from.\n')
          return
        }
        if (event.stopReason === 'max_tokens')
          out.write('\n\n(The answer hit max_tokens and is cut off.)')
        if (event.stopReason === 'refusal') out.write('\n\n(Claude declined to answer.)')
        out.write(`\n\n${formatCitations(citations)}\n`)
      }
    },
  })
}

/** Limits are per model, so embeddings and rerank each make one tiny request. */
export async function limitsCommand(ctx: CommandContext): Promise<void> {
  const { settings, meter } = ctx
  const { provider } = embeddingsFor(settings)
  if (provider.probeRateLimits === undefined) {
    throw new CliError(`${provider.id} cannot report rate limits`)
  }
  const probe = await provider.probeRateLimits()
  meter.recordEmbedding(provider.model, probe.tokens)
  writeLimits(ctx, provider.model, settings.embeddings, probe.headers)

  const reranker = createRerankProvider(settings.rerank)
  if (reranker.probeRateLimits === undefined) {
    throw new CliError(`${reranker.id} cannot report rate limits`)
  }
  const rerankProbe = await reranker.probeRateLimits()
  meter.recordRerank(reranker.model, rerankProbe.tokens)
  writeLimits(ctx, reranker.model, settings.rerank, rerankProbe.headers)
}

function writeLimits(
  { out }: CommandContext,
  model: string,
  {
    endpoint,
    rateLimit: { rpm, tpm },
  }: { endpoint: string; rateLimit: { rpm: number; tpm: number } },
  headers: Record<string, string>,
): void {
  out.write(
    `${model} configured: ${String(rpm)} requests and ${tpm.toLocaleString('en-US')} tokens per minute\n`,
  )
  const entries = Object.entries(headers)
  if (entries.length === 0) out.write(`${endpoint} sent no rate-limit headers.\n`)
  else for (const [name, value] of entries) out.write(`${name}: ${value}\n`)
}
