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
  if (existsSync(jsonPath)) throw new CliError(`${jsonPath} already exists`)

  const report = await measure(ctx, source, name ?? null, strategies)
  mkdirSync(join(jsonPath, '..'), { recursive: true })
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`)
  writeFileSync(join(dir, `${stem}.md`), formatEvalMarkdown(report))
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
    `report from ${report.run.repoSha.slice(0, 8)}, re-run at ${code}${now.run.repoDirty ? ' with uncommitted changes' : ''}\n`,
  )
  ctx.out.write(`${formatVerification(verification)}\n`)
  if (verification.status === 'not-comparable' || verification.status === 'different') {
    const sha = report.identity.docs.sha
    const hint =
      now.identity.docs.sha === sha ? '' : `: the report needs drl sync ${source.id} --at ${sha}`
    throw new CliError(`the report did not reproduce${hint}`)
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
  const version = (report: EvalReport) => report.identity.goldenSet.version
  if (
    version(a) !== version(b) ||
    a.identity.goldenSet.hash !== b.identity.goldenSet.hash ||
    a.identity.sourceId !== b.identity.sourceId
  ) {
    throw new CliError(
      `these reports measured different golden sets (version ${String(version(a))} and ${String(version(b))}), and numbers from two versions are never compared (ADR-0009): re-score both on one version`,
    )
  }
  const label = (report: EvalReport, path: string): string =>
    report.run.name ?? basename(path, '.json')
  if (a.identity.docs.sha !== b.identity.docs.sha) {
    ctx.out.write(
      `the docs differ: ${a.identity.docs.sha.slice(0, 8)} and ${b.identity.docs.sha.slice(0, 8)}\n\n`,
    )
  }
  const sections = STRATEGIES.flatMap((strategy) => {
    const before = strategyOf(a, strategy)
    const after = strategyOf(b, strategy)
    if (before === undefined || after === undefined) return []
    const comparison = compareScores(
      { name: label(a, args.a), questions: before.questions },
      { name: label(b, args.b), questions: after.questions },
    )
    return [formatEvalComparison(comparison, strategy, movedRanks(before, after))]
  })
  if (sections.length === 0) throw new CliError('these reports have no strategy in common')
  ctx.out.write(`${sections.join('\n\n')}\n`)
}
