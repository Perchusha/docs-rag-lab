// `drl sync <source> --compiled` (ADR-0017): the compiled index, at the plain index's commit. It
// compiles every example first, with no index and no call, and records what did not compile in a
// committed file per docs commit. Fewer than 90% compiled stops the work. Without --yes it then
// prints what it would embed; with --yes it builds the index, in a file of its own.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import {
  COMPILER_IDENTITY_PREFIX,
  contextDocumentsAt,
  embeddingCacheKey,
  estimateTokens,
  openIndexes,
  readIndexCommit,
  sourceIndexPath,
  type CompileResult,
  type Source,
} from '@docs-rag-lab/core'

import {
  checkoutDirOf,
  embeddingsFor,
  findSource,
  runSync,
  type CommandContext,
} from './commands.ts'
import { CliError } from './errors.ts'
import { formatDuration } from './format.ts'

/** The share of examples that has to compile, fixed before any compile (ADR-0017). */
export const COMPILE_THRESHOLD = 0.9

/** What the compile found at one docs commit, as committed beside the reports. */
export interface CompileRecord {
  compiler: string
  docsCommit: string
  examples: number
  compiled: number
  failed: { path: string; index: number; lang: string; reason: string }[]
}

export function compileRecordPath(root: string, sourceId: string, commit: string): string {
  return join(root, 'eval', 'compile', sourceId, `${commit}.json`)
}

export function compileRecordOf(
  compiler: string,
  docsCommit: string,
  results: readonly CompileResult[],
): CompileRecord {
  const failed = results
    .filter(({ ok }) => !ok)
    .map(({ path, index, lang, reason }) => ({ path, index, lang, reason: reason ?? '' }))
    .sort((a, b) => a.path.localeCompare(b.path) || a.index - b.index)
  return {
    compiler,
    docsCommit,
    examples: results.length,
    compiled: results.length - failed.length,
    failed,
  }
}

/** The failures by what the compiler said, with the error codes taken out, most frequent first. */
export function failureClasses(record: CompileRecord): [string, number][] {
  const classes = new Map<string, number>()
  for (const { reason } of record.failed) {
    const key = reason.replace(/\b\d{4,5}\b(, \d{4,5})*/g, '<code>')
    classes.set(key, (classes.get(key) ?? 0) + 1)
  }
  return [...classes].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

function formatRecord(record: CompileRecord): string {
  const share = record.examples === 0 ? 0 : record.compiled / record.examples
  return [
    `compiled ${String(record.compiled)} of ${String(record.examples)} examples (${(100 * share).toFixed(1)}%) with ${record.compiler}, at ${record.docsCommit.slice(0, 8)}`,
    ...failureClasses(record).map(([reason, n]) => `  ${String(n).padStart(4)}  ${reason}`),
  ].join('\n')
}

const count = (n: number): string => n.toLocaleString('en-US')

/** `drl sync <source> --compiled`. */
export async function syncCompiledCommand(
  ctx: CommandContext,
  args: { source: string; yes: boolean },
): Promise<void> {
  const plain: Source = findSource(ctx.sources, args.source)
  if (plain.compiled === undefined) {
    throw new CliError(
      `${plain.id} has no compiled index: only a source whose examples a compiler checks has one (ADR-0017)`,
    )
  }
  const dataDir = join(ctx.root, ctx.settings.dataDir)
  const commit = readIndexCommit(sourceIndexPath(dataDir, plain.id))
  if (commit === null) {
    throw new CliError(
      `there is no plain index for ${plain.id} yet, and this one is built at its commit: run drl sync ${plain.id} first`,
    )
  }

  // The compile, before any index or call.
  const start = ctx.now()
  const results: CompileResult[] = []
  const source = plain.compiled({ onResult: (result) => results.push(result) })
  const documents = await contextDocumentsAt(source, checkoutDirOf(ctx, plain), commit)
  const record = compileRecordOf(source.compiler, commit, results)
  const path = compileRecordPath(ctx.root, plain.id, commit)
  const text = `${JSON.stringify(record, null, 2)}\n`
  if (existsSync(path) && readFileSync(path, 'utf8') !== text) {
    throw new CliError(
      `the compile differs from the one recorded in ${path}: the same compiler on the same commit has to compile the same way`,
    )
  }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
  ctx.out.write(
    `${formatRecord(record)}\nrecorded: ${path} (${formatDuration(ctx.now() - start)})\n`,
  )
  if (record.examples === 0 || record.compiled / record.examples < COMPILE_THRESHOLD) {
    throw new CliError(
      `fewer than ${String(100 * COMPILE_THRESHOLD)}% of the examples compiled, so the work stops and the owner is asked (ADR-0017)`,
    )
  }

  if (!args.yes) {
    const { provider } = embeddingsFor(ctx)
    const indexes = openIndexes(dataDir, plain.id, { create: false })
    try {
      let texts = 0
      let tokens = 0
      for (const { chunks } of documents) {
        for (const chunk of chunks) {
          const key = embeddingCacheKey(provider.id, 'document', chunk.text)
          if (indexes.cache.getMany([key]).size > 0) continue
          texts++
          tokens += estimateTokens(chunk.text)
        }
      }
      const { batch, rateLimit } = ctx.settings.embeddings
      const minutes = Math.ceil(tokens / Math.min(rateLimit.tpm, batch.maxTokens * rateLimit.rpm))
      ctx.out.write(
        `this would embed ${count(texts)} texts with ${provider.model}, about ${count(tokens)} estimated tokens and ${String(minutes)} minutes at the free-trial limits, the rest from the cache: add --yes to build the compiled index\n`,
      )
    } finally {
      indexes.close()
    }
    return
  }

  const indexes = openIndexes(dataDir, plain.id, { variant: 'compiled' })
  try {
    await runSync(
      ctx,
      source,
      indexes,
      { at: commit, identity: `${COMPILER_IDENTITY_PREFIX}${source.compiler}` },
      'compiled',
    )
  } finally {
    indexes.close()
  }
}
