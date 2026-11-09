// drl eval pool: ADR-0019's test, two rows over several reports' questions together. It reads
// committed reports and calls nothing. With --name it writes the result under eval/pooled/,
// outside eval/reports/, whose folders are sources.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { AnswerRow, DifferenceVerdict, EvalPooled } from '@docs-rag-lab/contracts'
import { PoolError, poolReports } from '@docs-rag-lab/core'

import type { CommandContext } from './commands.ts'
import { CliError } from './errors.ts'
import { checkRunName, readReport } from './eval-commands.ts'

function table(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const line = (cells: readonly string[]): string => `| ${cells.join(' | ')} |`
  return [line(header), line(header.map(() => '---')), ...rows.map(line)].join('\n')
}

const rowName = (row: AnswerRow): string => `row ${String(row)}`

function verdictWords(verdict: DifferenceVerdict, a: AnswerRow, b: AnswerRow): string {
  switch (verdict) {
    case 'a':
      return `${rowName(a)} better`
    case 'b':
      return `${rowName(b)} better`
    case 'not-significant':
      return 'not significant'
    case 'too-few':
      return 'too few to say'
    default:
      return verdict
  }
}

const runToRun = (value: number | null): string => (value === null ? '-' : String(value))

/** The test as markdown. Like a report's, it quotes neither the docs nor Claude. */
export function formatPooled(pooled: EvalPooled): string {
  const { a, b } = pooled
  const fully = pooled.metrics.find(({ metric }) => metric === 'fully-correct')
  const guardForA = pooled.metrics.filter(({ verdict }) => verdict === 'a')
  const missing = pooled.runToRunMissing.map(rowName).join(' and ')
  const why = pooled.holds
    ? `the verdict names ${rowName(b)} on fully correct, past twice the larger run to run, and names ${rowName(a)} on no guard.`
    : fully?.verdict !== 'b'
      ? `the verdict on fully correct is "${verdictWords(fully?.verdict ?? 'noise', a, b)}", not ${rowName(b)} better.`
      : guardForA.length > 0
        ? `a guard names ${rowName(a)}: ${guardForA.map(({ metric }) => metric).join(', ')}.`
        : pooled.runToRunMissing.length > 0
          ? `${missing} was answered once in some report, so the run to run that the margin must pass is unknown.`
          : 'some first answers have no verdict.'
  const shown = pooled.holds ? `${rowName(b)} is shown better` : `${rowName(b)} is not shown better`
  const h =
    a === 3 && b === 6 ? ` So ADR-0019's H ${pooled.holds ? 'holds' : 'does not hold'}.` : ''
  return [
    `# ${rowName(a)} against ${rowName(b)}, over ${String(pooled.reports.length)} reports together`,
    table(
      ['Source', 'Report', 'Commit', 'Golden set'],
      pooled.reports.map((report) => [
        report.sourceId,
        `${report.name ?? 'development run'}, ${report.createdAt.slice(0, 10)}`,
        `\`${report.repoSha.slice(0, 8)}\``,
        `version ${String(report.goldenSet.version)}, \`${report.goldenSet.hash.slice(0, 12)}\``,
      ]),
    ),
    'Fully correct is counted from the first answers, and an answer that did not finish counts as not fully correct. The guards add up the comparisons each report made itself. A verdict that names a side has to pass twice the larger run to run, the questions on which a row differs from its own second answers (ADR-0013).',
    table(
      [
        'Metric',
        'Questions',
        `${rowName(a)} better on`,
        `${rowName(b)} better on`,
        'Tied',
        'p',
        `Run to run, ${rowName(a)} and ${rowName(b)}`,
        'Verdict',
      ],
      pooled.metrics.map((metric) => [
        metric.metric,
        String(metric.questions),
        String(metric.aBetter),
        String(metric.bBetter),
        String(metric.tied),
        metric.p.toFixed(3),
        `${runToRun(metric.runToRun.a)}, ${runToRun(metric.runToRun.b)}`,
        verdictWords(metric.verdict, a, b),
      ]),
    ),
    `**${shown}:** ${why}${h}`,
    pooled.notOk.length === 0
      ? 'Every first answer of both rows finished.'
      : `First answers that did not finish, each counted as not fully correct: ${pooled.notOk
          .map((item) => `${item.questionId} (${rowName(item.row)}, ${item.status})`)
          .join(', ')}.`,
    ...(pooled.unjudged.length === 0
      ? []
      : [
          `First answers with no verdict, each counted as not fully correct: ${pooled.unjudged
            .map((item) => `${item.questionId} (${rowName(item.row)})`)
            .join(', ')}.`,
        ]),
    pooled.hallucinations.length === 0
      ? `${rowName(b)} made no hallucination on the questions the docs do not answer.`
      : `${rowName(b)} hallucinated on: ${pooled.hallucinations
          .map(({ questionId }) => questionId)
          .join(', ')}.`,
  ].join('\n\n')
}

/** `drl eval pool <report> <report>...`: prints the test, and with --name writes it. */
export function evalPoolCommand(
  ctx: CommandContext,
  args: { paths: readonly string[]; rows: readonly AnswerRow[]; name: string | undefined },
): void {
  checkRunName(args.name)
  if (args.paths.length === 0) throw new CliError('eval pool needs a report file or more')
  const [a, b] = args.rows
  if (args.rows.length !== 2 || a === undefined || b === undefined) {
    throw new CliError('eval pool compares two rows, such as --rows 3,6')
  }
  const reports = args.paths.map((path) => readReport(ctx.root, path))
  let pooled: EvalPooled
  try {
    pooled = poolReports(reports, a, b)
  } catch (error) {
    if (error instanceof PoolError) throw new CliError(error.message)
    throw error
  }
  const markdown = formatPooled(pooled)
  ctx.out.write(`${markdown}\n`)
  if (args.name === undefined) return
  const dir = join(ctx.root, 'eval', 'pooled')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${args.name}.json`), `${JSON.stringify(pooled, null, 2)}\n`)
  writeFileSync(join(dir, `${args.name}.md`), `${markdown}\n`)
  ctx.out.write(`\nwritten: eval/pooled/${args.name}.json and .md\n`)
}
