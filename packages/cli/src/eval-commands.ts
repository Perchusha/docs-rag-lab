// drl eval: retrieval metrics over the golden set, written as a report (SPEC section
// 10, ADR-0010). No Claude call. A run with --name is one the repository keeps, so it
// needs a clean tree and a clean golden check; anything else is a development run,
// written under dev/, which git ignores.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

import {
  parseEvalReport,
  STRATEGIES,
  type EvalReport,
  type EvalStrategyResult,
  type Strategy,
} from '@docs-rag-lab/contracts'
import {
  compareScores,
  fieldDifferences,
  openIndexes,
  parseEvalTargets,
  readRepoState,
  runRetrievalEval,
  verifyReport,
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
import { formatGoldenCheck } from './format.ts'
import { goldenSetPath, goldenTargetsPath, readGoldenFiles } from './golden.ts'

const NAME = /^[a-z0-9][a-z0-9-]*$/

export function reportsDir(root: string, sourceId: string): string {
  return join(root, 'eval', 'reports', sourceId)
}

async function measure(
  ctx: CommandContext,
  source: Source,
  name: string | null,
  strategies: readonly Strategy[],
): Promise<EvalReport> {
  const { root, settings, meter } = ctx
  const repo = await readRepoState(root)
  if (name !== null && repo.dirty) {
    throw new CliError(
      `a named run needs a clean tree, so that its report can be reproduced from ${repo.sha.slice(0, 8)}: commit or stash first, or leave out --name`,
    )
  }
  const indexes = openIndexes(join(root, settings.dataDir), source.id, { create: false })
  try {
    const golden = readGoldenFiles(root, source.id, indexes.index)
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
      engine: ctx.engine,
      sourceId: source.id,
      questions,
      check,
      strategies,
      targets: existsSync(targetsPath)
        ? parseEvalTargets(readFileSync(targetsPath, 'utf8'), questions)
        : [],
      manifest,
      retrieval: settings.retrieval,
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
  args: { source: string; name: string | undefined; strategy: Strategy | undefined },
): Promise<void> {
  const { name } = args
  if (name !== undefined && !NAME.test(name)) {
    throw new CliError(`--name takes lowercase words with hyphens, such as baseline, got "${name}"`)
  }
  if (name !== undefined && args.strategy !== undefined) {
    throw new CliError('a named run measures every strategy, so that later runs can be compared')
  }
  const source = findSource(ctx.sources, args.source)
  const strategies = args.strategy === undefined ? STRATEGIES : [args.strategy]

  // A named report is never overwritten: its file is what was committed.
  const now = new Date(ctx.now())
  const dir = reportsDir(ctx.root, source.id)
  const sha = (await readRepoState(ctx.root)).sha.slice(0, 8)
  const stem =
    name === undefined
      ? join('dev', `${now.toISOString().replaceAll(/[:.]/g, '-')}-${sha}`)
      : `${now.toISOString().slice(0, 10)}-${sha}-${name}`
  const jsonPath = join(dir, `${stem}.json`)
  const markdownPath = join(dir, `${stem}.md`)
  // Before a run that may take a while. Writing with wx below settles it for good.
  for (const path of [jsonPath, markdownPath]) {
    if (existsSync(path)) throw new CliError(`${path} already exists`)
  }

  const report = await measure(ctx, source, name ?? null, strategies)
  mkdirSync(join(jsonPath, '..'), { recursive: true })
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' })
  writeFileSync(markdownPath, formatEvalMarkdown(report), { flag: 'wx' })
  ctx.out.write(`${formatEvalSummary(report)}\n\nreport: ${jsonPath}\n`)
}

function readReport(root: string, path: string): EvalReport {
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
  args: { path: string },
): Promise<void> {
  const report = readReport(ctx.root, args.path)
  const source = findSource(ctx.sources, report.identity.sourceId)
  const strategies = report.result.strategies.map(({ strategy }) => strategy)
  const now = await measure(ctx, source, null, strategies)
  const verification = verifyReport(report, now)
  const code =
    now.run.repoSha === report.run.repoSha ? 'the same commit' : now.run.repoSha.slice(0, 8)
  ctx.out.write(
    `report from ${report.run.repoSha.slice(0, 8)}${report.run.repoDirty ? ' with uncommitted changes' : ''}, ` +
      `re-run at ${code}${now.run.repoDirty ? ' with uncommitted changes' : ''}\n`,
  )
  ctx.out.write(`${formatVerification(verification)}\n`)
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
export function evalCompareCommand(ctx: CommandContext, args: { a: string; b: string }): void {
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
  const sections = STRATEGIES.flatMap((strategy) => {
    const before = strategyOf(a, strategy)
    const after = strategyOf(b, strategy)
    if (before === undefined || after === undefined) return []
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
