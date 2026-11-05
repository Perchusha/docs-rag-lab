// drl eval: retrieval metrics over the golden set, written as a report (SPEC section
// 10, ADR-0010). No Claude call. A run with --name is one the repository keeps, so it
// needs a clean tree and a clean golden check; anything else is a development run,
// written under dev/, which git ignores.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

import {
  LOCAL_STRATEGIES,
  parseEvalReport,
  STRATEGIES,
  type EvalReport,
  type EvalStrategyResult,
  type EvalVerifyRecord,
  type Strategy,
} from '@docs-rag-lab/contracts'
import {
  compareScores,
  fieldDifferences,
  isSidecarName,
  openIndexes,
  parseEvalTargets,
  readRepoState,
  reportsDir,
  readSourceAbout,
  runRetrievalEval,
  variantOfContextModel,
  verifyRecordPath,
  verifyReport,
  type IndexVariant,
  type Source,
} from '@docs-rag-lab/core'

import { findSource, type CommandContext } from './commands.ts'
import { CliError } from './errors.ts'
import {
  formatEvalComparison,
  formatEvalMarkdown,
  formatEvalSummary,
  formatVerification,
  NOISE_NOTE,
} from './eval-format.ts'
import { planRerankRun } from './eval-rerank.ts'
import { formatGoldenCheck } from './format.ts'
import { goldenSetPath, goldenTargetsPath, readGoldenFiles } from './golden.ts'

const NAME = /^[a-z0-9][a-z0-9-]*$/

export { reportsDir }

/** Before anything that spends: a name must fit a file, and not read as a file next to a report. */
export function checkRunName(name: string | undefined): void {
  if (name === undefined) return
  if (!NAME.test(name)) {
    throw new CliError(`--name takes lowercase words with hyphens, such as baseline, got "${name}"`)
  }
  if (isSidecarName(name)) {
    throw new CliError(
      `--name cannot be "${name}": its report would read as a calibration or verify file`,
    )
  }
}

export async function measure(
  ctx: CommandContext,
  source: Source,
  name: string | null,
  strategies: readonly Strategy[] = LOCAL_STRATEGIES,
  variant?: IndexVariant,
  /** The set a report names, for verify. Without it, the current set (ADR-0017). */
  setHash?: string,
): Promise<EvalReport> {
  const { root, settings, meter } = ctx
  const repo = await readRepoState(root)
  if (name !== null && repo.dirty) {
    throw new CliError(
      `a named run needs a clean tree, so that its report can be reproduced from ${repo.sha.slice(0, 8)}: commit or stash first, or leave out --name`,
    )
  }
  const indexes = openIndexes(join(root, settings.dataDir), source.id, { create: false, variant })
  try {
    const golden = readGoldenFiles(root, source.id, indexes.index, { setHash, variant })
    if (golden === undefined) {
      throw new CliError(
        `${source.id} has no golden set: ${goldenSetPath(root, source.id)} does not exist`,
      )
    }
    const { questions, check } = golden
    if (check.setChanged) {
      ctx.out.write(`${formatGoldenCheck(check)}\n`)
      throw new CliError(
        'the golden set differs from its lock, so no report could say which version it measured',
      )
    }
    if (name !== null && (check.findings.length > 0 || check.docsMovedFrom !== undefined)) {
      ctx.out.write(`${formatGoldenCheck(check)}\n`)
      throw new CliError('a named run needs a clean golden check: run drl eval check first')
    }
    const manifest = indexes.index.getManifest()
    if (manifest === undefined) throw new CliError(`the index of ${source.id} is empty`)
    const targetsPath = goldenTargetsPath(root, source.id)
    return await runRetrievalEval({
      engine: variant === undefined ? ctx.engine : ctx.engineFor(variant),
      sourceId: source.id,
      questions,
      check,
      strategies,
      targets: existsSync(targetsPath)
        ? parseEvalTargets(readFileSync(targetsPath, 'utf8'), questions)
        : [],
      manifest,
      retrieval: settings.retrieval,
      rerank: { model: settings.rerank.model, depth: settings.rerank.depth },
      index: indexes.index,
      meter,
      run: {
        name,
        createdAt: new Date(ctx.now()).toISOString(),
        repoSha: repo.sha,
        repoDirty: repo.dirty,
      },
    })
  } finally {
    indexes.close()
  }
}

/** `drl eval`: measure, write the report, and say where. */
export async function evalRunCommand(
  ctx: CommandContext,
  args: {
    source: string
    name: string | undefined
    strategy: Strategy | undefined
    yes: boolean
    variant: IndexVariant | undefined
  },
): Promise<void> {
  const { name, variant } = args
  checkRunName(name)
  if (name !== undefined && args.strategy !== undefined) {
    throw new CliError('a named run measures every strategy, so that later runs can be compared')
  }
  if (variant === 'control' && args.strategy === 'rerank') {
    throw new CliError('the control is measured without the reranker (ADR-0014)')
  }
  if (variant === 'compiled' && args.strategy === 'rerank') {
    throw new CliError('the compiled index is measured without the reranker (ADR-0017)')
  }
  const source = findSource(ctx.sources, args.source)
  // A development run stays quick: a rerank takes up to a minute per question on the free trial.
  // The control and the compiled index are measured with no reranker (ADR-0014, ADR-0017).
  const strategies =
    args.strategy !== undefined
      ? [args.strategy]
      : name === undefined || variant === 'control' || variant === 'compiled'
        ? LOCAL_STRATEGIES
        : STRATEGIES
  if (args.yes && !strategies.includes('rerank')) {
    throw new CliError('--yes does not apply to a run with no rerank, which needs no confirming')
  }
  // Before a run that may take a while. Writing with wx settles it for good.
  reportPaths(ctx, source, name, (await readRepoState(ctx.root)).sha)

  if (strategies.includes('rerank') && !args.yes) {
    const plan = await planRerankRun(ctx, source.id, variant)
    if (plan.calls > 0) {
      ctx.out.write(
        `this would make ${String(plan.calls)} calls to ${ctx.settings.rerank.model}, about ${plan.estimatedTokens.toLocaleString('en-US')} estimated tokens and ${plan.duration} at the free-trial limits: add --yes to run them\n`,
      )
      return
    }
  }

  const report = await measure(ctx, source, name ?? null, strategies, variant)
  await ctx.guard?.check()
  const path = writeReport(ctx, source, name, report)
  ctx.out.write(`${formatEvalSummary(report)}\n\nreport: ${path}\n`)
}

/** Where a report goes. A named report is never overwritten: its file is what was committed. */
function reportPaths(
  ctx: CommandContext,
  source: Source,
  name: string | undefined,
  repoSha: string,
): { jsonPath: string; markdownPath: string } {
  const now = new Date(ctx.now())
  const sha = repoSha.slice(0, 8)
  const stem =
    name === undefined
      ? join('dev', `${now.toISOString().replaceAll(/[:.]/g, '-')}-${sha}`)
      : `${now.toISOString().slice(0, 10)}-${sha}-${name}`
  const dir = reportsDir(ctx.root, source.id)
  const jsonPath = join(dir, `${stem}.json`)
  const markdownPath = join(dir, `${stem}.md`)
  for (const path of [jsonPath, markdownPath]) {
    if (existsSync(path)) throw new CliError(`${path} already exists`)
  }
  return { jsonPath, markdownPath }
}

/** Writes the JSON and the markdown, and returns where the JSON went. */
export function writeReport(
  ctx: CommandContext,
  source: Source,
  name: string | undefined,
  report: EvalReport,
  extraSections: (answers: NonNullable<EvalReport['answers']>) => string[] = () => [],
): string {
  const { jsonPath, markdownPath } = reportPaths(ctx, source, name, report.run.repoSha)
  mkdirSync(join(jsonPath, '..'), { recursive: true })
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' })
  const about = readSourceAbout(ctx.root, source.id).set
  writeFileSync(markdownPath, reportMarkdown(report, extraSections, about), { flag: 'wx' })
  return jsonPath
}

/** A report's markdown, from its JSON. */
export function reportMarkdown(
  report: EvalReport,
  extraSections: (answers: NonNullable<EvalReport['answers']>) => string[],
  aboutTheSet?: string,
): string {
  const extra = report.answers === undefined ? [] : extraSections(report.answers)
  return [formatEvalMarkdown(report, aboutTheSet).trimEnd(), ...extra].join('\n\n') + '\n'
}

export function readReport(root: string, path: string): EvalReport {
  const full = resolve(root, path)
  if (!existsSync(full)) throw new CliError(`no report at ${full}`)
  let value: unknown
  try {
    value = JSON.parse(readFileSync(full, 'utf8'))
  } catch {
    throw new CliError(`${full} is not valid JSON`)
  }
  const parsed = parseEvalReport(value)
  if (!parsed.ok) throw new CliError(`${full}: ${parsed.error}`)
  return parsed.value
}

/** `drl eval verify <report>`: run the same thing again, and say whether it reproduces. */
export async function evalVerifyCommand(
  ctx: CommandContext,
  args: { path: string; record: boolean },
): Promise<void> {
  const report = readReport(ctx.root, args.path)
  const source = findSource(ctx.sources, report.identity.sourceId)
  const strategies = report.result.strategies.map(({ strategy }) => strategy)
  const variant = variantOfContextModel(report.identity.contextModel)
  const now = await measure(ctx, source, null, strategies, variant, report.identity.goldenSet.hash)
  const verification = verifyReport(report, now)
  const code =
    now.run.repoSha === report.run.repoSha ? 'the same commit' : now.run.repoSha.slice(0, 8)
  ctx.out.write(
    `report from ${report.run.repoSha.slice(0, 8)}${report.run.repoDirty ? ' with uncommitted changes' : ''}, ` +
      `re-run at ${code}${now.run.repoDirty ? ' with uncommitted changes' : ''}\n`,
  )
  ctx.out.write(`${formatVerification(verification)}\n`)
  if (args.record) {
    const record: EvalVerifyRecord = {
      status: verification.status,
      changedVectors: 'changedVectors' in verification ? verification.changedVectors : [],
      rerun: {
        repoSha: now.run.repoSha,
        repoDirty: now.run.repoDirty,
        at: new Date(ctx.now()).toISOString(),
      },
    }
    const path = verifyRecordPath(resolve(ctx.root, args.path))
    writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`)
    ctx.out.write(`recorded: ${path}\n`)
  }
  if (verification.status === 'inconclusive') {
    throw new CliError(
      report.run.repoDirty
        ? 'the report came from uncommitted changes, so no commit can tell code from vectors'
        : `run this at ${report.run.repoSha.slice(0, 8)} with a clean tree to tell code from vectors`,
    )
  }
  if (verification.status === 'different') throw new CliError('the report did not reproduce')
  if (verification.status === 'not-comparable') {
    const sha = report.identity.docs.sha
    const hint =
      now.identity.docs.sha === sha ? '' : `: the report needs drl sync ${source.id} --at ${sha}`
    throw new CliError(`this says nothing about the report, which measured something else${hint}`)
  }
}

function strategyOf(report: EvalReport, strategy: Strategy): EvalStrategyResult | undefined {
  return report.result.strategies.find((result) => result.strategy === strategy)
}

/** The primary ranks that differ between two runs of one strategy. */
function movedRanks(a: EvalStrategyResult, b: EvalStrategyResult): string[] {
  const after = new Map(b.questions.map((question) => [question.id, question]))
  return a.questions.flatMap((question) => {
    const other = after.get(question.id)
    if (other === undefined || other.primaryRank === question.primaryRank) return []
    const rank = (value: number | null): string => (value === null ? '-' : String(value))
    return [`${question.id}: ${rank(question.primaryRank)} -> ${rank(other.primaryRank)}`]
  })
}

/** `drl eval compare <a> <b>`: two reports, question by question. */
export function evalCompareCommand(
  ctx: CommandContext,
  args: { a: string; b: string; strategies: [Strategy, Strategy] | undefined },
): void {
  const a = readReport(ctx.root, args.a)
  const b = readReport(ctx.root, args.b)
  if (a.identity.sourceId !== b.identity.sourceId) {
    throw new CliError(
      `these reports measured different sources: ${a.identity.sourceId} and ${b.identity.sourceId}`,
    )
  }
  const version = (report: EvalReport) => report.identity.goldenSet.version
  if (version(a) !== version(b)) {
    throw new CliError(
      `these reports measured golden set versions ${String(version(a))} and ${String(version(b))}, and numbers from two versions are never compared (ADR-0009): re-score both on one version`,
    )
  }
  if (a.identity.goldenSet.hash !== b.identity.goldenSet.hash) {
    throw new CliError(
      `these reports both say golden set version ${String(version(a))}, with different contents, so one of them cannot be trusted`,
    )
  }
  const label = (report: EvalReport, path: string): string =>
    `${report.run.name ?? basename(path, '.json').slice(0, 19)}@${report.run.repoSha.slice(0, 8)}${report.run.repoDirty ? '+dirty' : ''}`
  const [labelA, labelB] = [label(a, args.a), label(b, args.b)]
  // One name at one commit, from two dates or two machines.
  const labels =
    labelA === labelB ? { a: `${labelA} (1)`, b: `${labelB} (2)` } : { a: labelA, b: labelB }
  // What else differs: a change of rank means little until this is known.
  const differences = [
    ...fieldDifferences('identity', a.identity, b.identity, labels),
    ...fieldDifferences('vectors', a.vectors, b.vectors, labels),
  ]
  ctx.out.write(
    differences.length > 0
      ? `these reports also differ in:\n${differences.map((line) => `  ${line}`).join('\n')}\n`
      : `these reports measured the same thing, on the same vectors\n`,
  )
  if (
    a.vectors.queryHash !== b.vectors.queryHash ||
    a.vectors.corpusHash !== b.vectors.corpusHash
  ) {
    ctx.out.write('with other vectors, ranks below the context can move by themselves (ADR-0010)\n')
  }
  ctx.out.write(`\n${NOISE_NOTE}\n\n`)
  // Like-named strategies, or the two asked for: H3 is one report's hybrid and another's rerank.
  const pairs: readonly [Strategy, Strategy][] =
    args.strategies === undefined
      ? STRATEGIES.map((strategy) => [strategy, strategy])
      : [args.strategies]
  const sections = pairs.flatMap(([first, second]) => {
    const before = strategyOf(a, first)
    const after = strategyOf(b, second)
    if (args.strategies !== undefined && before === undefined) {
      throw new CliError(`${labels.a} did not measure ${first}`)
    }
    if (args.strategies !== undefined && after === undefined) {
      throw new CliError(`${labels.b} did not measure ${second}`)
    }
    if (before === undefined || after === undefined) return []
    const strategy = first === second ? first : `${first} against ${second}`
    const comparison = compareScores(
      { name: labels.a, questions: before.questions },
      { name: labels.b, questions: after.questions },
    )
    const ids = (result: EvalStrategyResult) => new Set(result.questions.map(({ id }) => id))
    const dropped = [
      ...[...ids(before)].filter((id) => !ids(after).has(id)),
      ...[...ids(after)].filter((id) => !ids(before).has(id)),
    ]
    return [
      formatEvalComparison(comparison, strategy, movedRanks(before, after)) +
        (dropped.length > 0 ? `\nscored by only one report: ${dropped.join(', ')}` : ''),
    ]
  })
  if (sections.length === 0) throw new CliError('these reports have no strategy in common')
  ctx.out.write(`${sections.join('\n\n')}\n`)
}
