// drl sync <source> --contextual and --control: the other indexes of ADR-0014. They are built at
// the plain index's commit and never write that index. Contexts come from the committed file
// first, and Claude writes only what is missing, so that a clean clone can rebuild the index
// without calling it. The control's prefixes come from code. Both print an estimate first and
// need --yes: the contexts spend money, and the embeddings take about an hour.
import { join } from 'node:path'

import {
  appendContext,
  CONTROL_IDENTITY,
  controlContexts,
  contextDocumentsAt,
  contextIdentity,
  contextPromptHash,
  contextsPath,
  contextualText,
  createClaudeClient,
  embeddingCacheKey,
  estimateTokens,
  forecastContexts,
  generateContexts,
  openIndexes,
  pilotChunks,
  planContexts,
  readContexts,
  readIndexCommit,
  sourceIndexPath,
  writeContexts,
  type ContextChunk,
  type ContextDocument,
  type ContextPlan,
  type ContextsHeader,
  type PlanContextsOptions,
  type Source,
  type StoredContext,
} from '@docs-rag-lab/core'

import {
  checkoutDirOf,
  embeddingsFor,
  findSource,
  PROGRESS_INTERVAL_MS,
  runSync,
  type CommandContext,
} from './commands.ts'
import { CliError } from './errors.ts'
import { formatDuration } from './format.ts'

const count = (n: number): string => n.toLocaleString('en-US')
const usd = (n: number): string => `$${n.toFixed(4)}`

/** What a context adds to the text to embed, until it is written. */
const CONTEXT_TOKENS_GUESS = 100

interface Prepared {
  source: Source
  commit: string
  documents: ContextDocument[]
  path: string
  header: ContextsHeader
  known: Map<string, StoredContext>
  options: PlanContextsOptions
}

/** The commit of the plain index, and every document as it was there. */
async function atPlainCommit(ctx: CommandContext, source: Source) {
  const commit = readIndexCommit(sourceIndexPath(join(ctx.root, ctx.settings.dataDir), source.id))
  if (commit === null) {
    throw new CliError(
      `there is no plain index for ${source.id} yet, and this one is built at its commit: run drl sync ${source.id} first`,
    )
  }
  return { commit, documents: await contextDocumentsAt(source, checkoutDirOf(ctx, source), commit) }
}

async function prepare(ctx: CommandContext, sourceId: string): Promise<Prepared> {
  const { settings, root } = ctx
  const source = findSource(ctx.sources, sourceId)
  const { commit, documents } = await atPlainCommit(ctx, source)
  const model = settings.models.contextualize
  const header: ContextsHeader = {
    version: 1,
    model,
    promptHash: contextPromptHash(settings.contextualize),
    docsCommit: commit,
  }
  const path = contextsPath(root, source.id, commit)
  const known = readContexts(path, header)
  return {
    source,
    commit,
    documents,
    path,
    header,
    known,
    options: { model, settings: settings.contextualize, pricing: settings.pricing, known },
  }
}

/** The texts a sync would embed that are not in the cache yet, and about how long they take. */
function embeddingPlan(
  ctx: CommandContext,
  source: Source,
  documents: readonly ContextDocument[],
  contextOf: (chunk: ContextChunk) => string | undefined,
) {
  const { provider } = embeddingsFor(ctx)
  const indexes = openIndexes(join(ctx.root, ctx.settings.dataDir), source.id, {
    create: false,
  })
  try {
    let estimatedTokens = 0
    let texts = 0
    for (const { chunks } of documents) {
      for (const chunk of chunks) {
        const context = contextOf(chunk)
        if (context !== undefined) {
          const text = contextualText(context, chunk.text)
          const key = embeddingCacheKey(provider.id, 'document', text)
          if (indexes.cache.getMany([key]).size > 0) continue
          estimatedTokens += estimateTokens(text)
        } else {
          estimatedTokens += estimateTokens(chunk.text) + CONTEXT_TOKENS_GUESS
        }
        texts++
      }
    }
    const { batch, rateLimit } = ctx.settings.embeddings
    const minutes = estimatedTokens / (batch.maxTokens * rateLimit.rpm)
    return { model: provider.model, texts, estimatedTokens, minutes }
  } finally {
    indexes.close()
  }
}

function formatPlan(plan: ContextPlan): string {
  const { cacheWrite, cacheRead, uncached, output } = plan.tokens
  return `${count(plan.toGenerate)} contexts over ${count(plan.documents)} documents, about ${usd(plan.inputUsd + plan.outputUsd)} (estimated tokens: ${count(cacheWrite)} cache write, ${count(cacheRead)} cache read, ${count(uncached)} uncached, ${count(output)} out)`
}

/** Writes the header, keeps what is usable, and calls Claude for what is missing. */
async function writeMissing(
  ctx: CommandContext,
  prepared: Prepared,
  documents: readonly ContextDocument[],
  only?: ReadonlySet<string>,
): Promise<Map<string, StoredContext>> {
  const { path, header, options } = prepared
  const contexts = new Map(prepared.known)
  writeContexts(path, header, contexts.values())
  let lastProgress = 0
  await generateContexts(documents, {
    ...options,
    only,
    client: ctx.createEvalClient?.() ?? createClaudeClient(),
    meter: ctx.meter,
    guard: ctx.guard,
    onContext: (context) => {
      appendContext(path, context)
      contexts.set(context.chunkId, context)
    },
    onProgress: (done, total) => {
      if (done === total || ctx.now() - lastProgress >= PROGRESS_INTERVAL_MS) {
        lastProgress = ctx.now()
        ctx.out.write(`contexts: ${count(done)}/${count(total)}\n`)
      }
    },
  })
  // In chunk ID order, and with nothing for a chunk that is gone or has changed.
  const current = new Map(
    documents.flatMap(({ chunks }) => chunks.map((chunk) => [chunk.id, chunk.textHash])),
  )
  writeContexts(
    path,
    header,
    [...contexts.values()].filter(({ chunkId, textHash }) => current.get(chunkId) === textHash),
  )
  return contexts
}

/** `drl sync <source> --contextual --pilot <n> --yes`: a look at the prompt, the text and the cost. */
async function runPilot(ctx: CommandContext, prepared: Prepared, size: number): Promise<void> {
  const { documents, options, known } = prepared
  const { settings, out, meter } = ctx
  const only = pilotChunks(documents, known, size)
  const pilot = planContexts(documents, { ...options, only })
  const whole = planContexts(documents, options)
  const contexts = await writeMissing(ctx, prepared, documents, only)

  const paths = new Map(
    documents.flatMap(({ path, chunks }) => chunks.map((chunk) => [chunk.id, path])),
  )
  for (const id of only) {
    out.write(`\n${paths.get(id) ?? ''} (${id})\n${contexts.get(id)?.context ?? ''}\n`)
  }
  const model = settings.models.contextualize
  const used = meter.entries().find(([name]) => name === model)?.[1]
  if (used === undefined) throw new Error('the pilot made no call')
  const forecast = forecastContexts(whole, pilot, used, model, settings.pricing)
  out.write(
    `\nthe pilot: ${count(pilot.toGenerate)} contexts, ${usd(meter.estimateCost(settings.pricing).byModel.get(model) ?? 0)}, ${forecast.outputTokensPerContext.toFixed(0)} tokens out per context, input at ${forecast.inputAgainstPlan.toFixed(2)} of the estimate\n` +
      `the forecast for all ${count(whole.toGenerate)} contexts: about ${usd(forecast.usd)}\n`,
  )
}

/** `drl sync <source> --contextual`. */
export async function syncContextualCommand(
  ctx: CommandContext,
  args: { source: string; yes: boolean; pilot: number | undefined },
): Promise<void> {
  const prepared = await prepare(ctx, args.source)
  const { source, documents, known, options, commit } = prepared
  const { settings, out } = ctx
  const model = settings.models.contextualize

  if (!args.yes) {
    if (args.pilot !== undefined) {
      const only = pilotChunks(documents, known, args.pilot)
      out.write(
        `this would write ${formatPlan(planContexts(documents, { ...options, only }))} with ${model}, and no index: add --yes to run it\n`,
      )
      return
    }
    const embeddings = embeddingPlan(ctx, source, documents, (chunk) => {
      const stored = known.get(chunk.id)
      return stored?.textHash === chunk.textHash ? stored.context : undefined
    })
    out.write(
      `this would write ${formatPlan(planContexts(documents, options))} with ${model}, then embed ${count(embeddings.texts)} texts with ${embeddings.model}, about ${count(embeddings.estimatedTokens)} estimated tokens and at least ${formatDuration(embeddings.minutes * 60_000)} on the free trial, at docs commit ${commit.slice(0, 8)}: add --yes to run them\n`,
    )
    return
  }

  if (args.pilot !== undefined) {
    await runPilot(ctx, prepared, args.pilot)
    return
  }

  const indexes = openIndexes(join(ctx.root, settings.dataDir), source.id, {
    variant: 'contextual',
  })
  try {
    await runSync(ctx, source, indexes, {
      at: commit,
      contexts: {
        identity: contextIdentity(model, settings.contextualize),
        resolve: async (parsed) => {
          const contexts = await writeMissing(ctx, prepared, parsed)
          return new Map([...contexts].map(([id, { context }]) => [id, context]))
        },
      },
    })
  } finally {
    indexes.close()
  }
}

/** `drl sync <source> --control`: the same pipeline, with a prefix from the chunk's headings. */
export async function syncControlCommand(
  ctx: CommandContext,
  args: { source: string; yes: boolean },
): Promise<void> {
  const source = findSource(ctx.sources, args.source)
  const { commit, documents } = await atPlainCommit(ctx, source)
  if (!args.yes) {
    const prefixes = controlContexts(documents)
    const embeddings = embeddingPlan(ctx, source, documents, ({ id }) => prefixes.get(id))
    ctx.out.write(
      `this would embed ${count(embeddings.texts)} texts with ${embeddings.model}, about ${count(embeddings.estimatedTokens)} estimated tokens and at least ${formatDuration(embeddings.minutes * 60_000)} on the free trial, at docs commit ${commit.slice(0, 8)}, with no call to Claude: add --yes to run them\n`,
    )
    return
  }
  const indexes = openIndexes(join(ctx.root, ctx.settings.dataDir), source.id, {
    variant: 'control',
  })
  try {
    await runSync(ctx, source, indexes, {
      at: commit,
      contexts: {
        identity: CONTROL_IDENTITY,
        resolve: (parsed) => Promise.resolve(controlContexts(parsed)),
      },
    })
  } finally {
    indexes.close()
  }
}
