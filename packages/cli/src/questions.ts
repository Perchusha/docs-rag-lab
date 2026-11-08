// drl questions: the interview bank (ADR-0018). Compiler questions cost nothing and are written on
// every run. Generated questions spend money, so the command prints its estimate and needs --yes,
// and a pilot comes first. The sample of M8's test and the score of its labels need no call.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import {
  appendBankRows,
  bankDocuments,
  bankIdentity,
  bankPath,
  bankPilotChunks,
  bankSample,
  bankSampleHash,
  checkBank,
  COMPILER_IDENTITY_PREFIX,
  compilerQuestions,
  createClaudeClient,
  forecastBank,
  generateBank,
  generatedChunks,
  keptGeneratedRows,
  openIndexes,
  planBank,
  readBank,
  writeBank,
  type BankDocument,
  type BankHeader,
  type BankLabel,
  type BankRow,
  type QuestionRow,
  type Source,
} from '@docs-rag-lab/core'

import { findSource, PROGRESS_INTERVAL_MS, type CommandContext } from './commands.ts'
import { CliError } from './errors.ts'
import {
  formatBankCheck,
  formatBankPlan,
  formatBankSheet,
  formatPilotQuestion,
} from './questions-format.ts'

const count = (n: number): string => n.toLocaleString('en-US')
const usd = (n: number): string => `$${n.toFixed(4)}`

/** A source with a compiler builds its bank from the compiled index, which holds the compiler's output. */
const variantOf = (source: Source): BankHeader['variant'] =>
  source.compiled === undefined ? 'plain' : 'compiled'

/** The documents in the bank's scope, the docs commit and the compiler, from the bank's index. */
function readIndex(ctx: CommandContext, source: Source) {
  const variant = variantOf(source)
  const indexes = openIndexes(join(ctx.root, ctx.settings.dataDir), source.id, {
    create: false,
    ...(variant === 'compiled' ? { variant } : {}),
  })
  try {
    const manifest = indexes.index.getManifest()
    if (manifest === undefined)
      throw new CliError(`the ${variant} index of ${source.id} has no manifest: sync it first`)
    const contextModel = manifest.contextModel ?? ''
    const compiler = contextModel.startsWith(COMPILER_IDENTITY_PREFIX)
      ? contextModel.slice(COMPILER_IDENTITY_PREFIX.length)
      : ''
    return {
      variant,
      commit: manifest.commitSha,
      compiler,
      documents: bankDocuments(source, indexes.index),
    }
  } finally {
    indexes.close()
  }
}

const currentKeys = (documents: readonly BankDocument[]): Map<string, string> =>
  new Map(documents.flatMap(({ chunks }) => chunks.map((chunk) => [chunk.id, chunk.textHash])))

const chunkIdOf = (row: BankRow): string =>
  row.row === 'chunk' ? row.chunkId : row.question.citation.chunkId

/** `drl questions <source> [--pilot <n>] [--yes]`. */
export async function questionsCommand(
  ctx: CommandContext,
  args: { source: string; yes: boolean; pilot: number | undefined },
): Promise<void> {
  const { settings, out, meter } = ctx
  const source = findSource(ctx.sources, args.source)
  if (source.interviewTopic === undefined)
    throw new CliError(`${source.id} has no interview topics, so no bank`)
  const { variant, commit, compiler, documents } = readIndex(ctx, source)
  const models = { generate: settings.models.questions, check: settings.models.questionCheck }
  const header: BankHeader = {
    version: 1,
    source: source.id,
    variant,
    docsCommit: commit,
    ...bankIdentity(models, settings.interviewBank),
  }
  const path = bankPath(ctx.root, source.id)

  const current = currentKeys(documents)
  const fromCompiler: QuestionRow[] = documents.flatMap((document) =>
    compilerQuestions(source, document, compiler).map(({ question, textHash }) => ({
      row: 'question' as const,
      status: 'shown' as const,
      textHash,
      question,
    })),
  )
  // What earlier runs paid for, for chunks whose text is still the same.
  const kept = keptGeneratedRows(readBank(path), header).filter(
    (row) => current.get(chunkIdOf(row)) === row.textHash,
  )
  const known = generatedChunks(kept)
  const options = { models, settings: settings.interviewBank, pricing: settings.pricing, known }
  const rows: BankRow[] = [...fromCompiler, ...kept]
  writeBank(path, header, rows)
  const shownKept = kept.filter((row) => row.row === 'question' && row.status === 'shown').length
  out.write(
    `${count(fromCompiler.length)} compiler questions and ${count(shownKept)} generated questions kept from earlier runs, written to ${path}, from ${count(documents.length)} documents at docs commit ${commit.slice(0, 8)}\n`,
  )

  const only = args.pilot === undefined ? undefined : bankPilotChunks(documents, known, args.pilot)
  const plan = planBank(documents, { ...options, only })
  if (plan.chunks === 0) {
    out.write('every chunk in scope has been read: nothing to write\n')
    return
  }
  if (!args.yes) {
    out.write(
      `this would ${args.pilot === undefined ? '' : 'pilot: '}write and check ${formatBankPlan(plan, models)}\nadd --yes to run it${args.pilot === undefined ? ', after a pilot (--pilot 10 --yes)' : ''}\n`,
    )
    return
  }

  const whole = planBank(documents, options)
  const written: BankRow[] = []
  let lastProgress = 0
  try {
    await generateBank(documents, {
      ...options,
      only,
      source,
      client: ctx.createEvalClient?.() ?? createClaudeClient(),
      meter,
      guard: ctx.guard,
      onRows: (chunkRows) => {
        appendBankRows(path, chunkRows)
        written.push(...chunkRows)
      },
      onProgress: (done, total) => {
        if (done === total || ctx.now() - lastProgress >= PROGRESS_INTERVAL_MS) {
          lastProgress = ctx.now()
          out.write(`chunks: ${count(done)}/${count(total)}\n`)
        }
      },
    })
  } finally {
    // In chunk order, with what this run paid for.
    writeBank(path, header, [...rows, ...written])
  }

  const questions = written.filter((row): row is QuestionRow => row.row === 'question')
  const byStatus = new Map<string, number>()
  for (const row of questions) byStatus.set(row.status, (byStatus.get(row.status) ?? 0) + 1)
  out.write(
    `\n${count(questions.length)} questions written: ${[...byStatus].map(([status, n]) => `${count(n)} ${status}`).join(', ') || 'none'}\n`,
  )
  if (args.pilot !== undefined) {
    for (const row of questions) out.write(`\n${formatPilotQuestion(row)}\n`)
    const used = new Map(meter.entries())
    const forecast = forecastBank(whole, plan, used, models, settings.pricing)
    out.write(
      `\nthe pilot: ${count(plan.chunks)} chunks, ${usd(meter.estimateCost(settings.pricing).total)}; writing at ${forecast.generateAgainstPlan.toFixed(2)} of its estimate, checking at ${forecast.checkAgainstPlan.toFixed(2)}\n` +
        `the forecast for all ${count(whole.chunks)} chunks: about ${usd(forecast.usd)}, against $${String(settings.interviewBank.maxUsd)} for the run\n`,
    )
  }
}

/** Every source with a bank, its current shown rows, and the text of each row's chunk. */
function currentBanks(ctx: CommandContext) {
  const rowsBySource = new Map<string, QuestionRow[]>()
  const texts = new Map<string, string>()
  for (const source of ctx.sources) {
    if (source.interviewTopic === undefined) continue
    const bank = readBank(bankPath(ctx.root, source.id))
    if (bank === undefined)
      throw new CliError(`there is no bank for ${source.id} yet: run drl questions ${source.id}`)
    const { documents } = readIndex(ctx, source)
    const chunks = new Map(
      documents.flatMap(({ chunks: list }) => list.map((chunk) => [chunk.id, chunk])),
    )
    const rows = bank.rows.filter(
      (row): row is QuestionRow =>
        row.row === 'question' &&
        chunks.get(row.question.citation.chunkId)?.textHash === row.textHash,
    )
    for (const row of rows)
      texts.set(row.question.id, chunks.get(row.question.citation.chunkId)?.text ?? '')
    rowsBySource.set(source.id, rows)
  }
  return { rowsBySource, texts }
}

export const sheetPath = (root: string): string => join(root, 'interview', 'dev', 'labels-bank.md')
export const checkPath = (root: string): string => join(root, 'interview', 'bank-check.json')

/** `drl questions sample`: the sheet of M8's test, with nothing of the checker. */
export function questionsSampleCommand(ctx: CommandContext): void {
  const { rowsBySource, texts } = currentBanks(ctx)
  const sample = bankSample(rowsBySource)
  const hash = bankSampleHash(sample)
  const path = sheetPath(ctx.root)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(
    path,
    `${formatBankSheet(sample, hash, (row) => texts.get(row.question.id) ?? '')}\n`,
  )
  ctx.out.write(`${String(sample.length)} questions to label, sample ${hash}: ${path}\n`)
}

interface LabelFile {
  sample: string
  labels: BankLabel[]
}

/** `drl questions score <labels>`: H against the owner's labels. */
export function questionsScoreCommand(ctx: CommandContext, args: { labels: string }): void {
  const full = resolve(ctx.root, args.labels)
  if (!existsSync(full)) throw new CliError(`no labels at ${full}`)
  const file = JSON.parse(readFileSync(full, 'utf8')) as LabelFile
  const sample = bankSample(currentBanks(ctx).rowsBySource)
  const hash = bankSampleHash(sample)
  if (file.sample !== hash) {
    throw new CliError(
      `these labels are of sample ${file.sample}, and the bank gives ${hash}: they would be read against other questions`,
    )
  }
  const items = file.labels.map(({ item }) => item).sort((a, b) => a - b)
  const missing = sample.map((_, i) => i + 1).filter((item) => !items.includes(item))
  if (missing.length > 0 || new Set(items).size !== items.length) {
    throw new CliError(
      `every item needs one label: ${missing.length > 0 ? `${missing.join(', ')} missing` : 'one appears twice'}`,
    )
  }
  const check = checkBank(sample, file.labels)
  const path = checkPath(ctx.root)
  writeFileSync(path, `${JSON.stringify(check, null, 2)}\n`)
  const text = formatBankCheck(check)
  writeFileSync(path.replace(/\.json$/, '.md'), text)
  ctx.out.write(text)
}
