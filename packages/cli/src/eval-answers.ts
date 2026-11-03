// drl eval answers, label, calibrate and judge-check: answer metrics (SPEC section 10,
// ADR-0012). These are the eval commands that spend money, so each prints an estimate first,
// and none makes a paid call without --yes.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

import {
  ANSWER_ROWS,
  type AnswerLabel,
  type AnswerRow,
  type EvalAnswers,
  type EvalReport,
} from '@docs-rag-lab/contracts'
import {
  anchorCandidates,
  anchorKey,
  calibrate,
  compareRows,
  createClaudeClient,
  CORRECTNESS_SYSTEM_PROMPT,
  estimateCost,
  freshSampleForLabels,
  isUnanswerable,
  judgeSentence,
  judgeTrust,
  readCalibrations,
  judgeCases,
  judgeRetest,
  noRagSystemPrompt,
  openEvalCache,
  openIndexes,
  planAnswers,
  promptHash,
  REFUSAL_SYSTEM_PROMPT,
  rowResult,
  runAnswers,
  runJudge,
  runJudgeCheck,
  sampleForLabels,
  sampleHash,
  SUPPORT_SYSTEM_PROMPT,
  ANSWER_SYSTEM_PROMPT,
  type EvalCache,
  type EvalClient,
  type GoldenQuestion,
  type RunnerOptions,
  type Source,
} from '@docs-rag-lab/core'

import { findSource, type CommandContext } from './commands.ts'
import { CliError } from './errors.ts'
import {
  answerSections,
  formatAnswersSummary,
  formatCalibration,
  formatCostEstimate,
  formatJudgeCheck,
  formatLabelSheet,
} from './eval-answers-format.ts'
import { measure, readReport, reportsDir, writeReport } from './eval-commands.ts'
import { readGoldenFiles } from './golden.ts'

/** The Claude client. Tests pass a fake through the command context. */
const clientOf = (ctx: CommandContext): EvalClient =>
  ctx.createEvalClient?.() ?? createClaudeClient()

function withEvalCache<T>(ctx: CommandContext, run: (cache: EvalCache) => Promise<T>): Promise<T> {
  const cache = openEvalCache(join(ctx.root, ctx.settings.dataDir, 'eval-cache.sqlite'))
  return run(cache).finally(() => {
    cache.close()
  })
}

interface Golden {
  questions: GoldenQuestion[]
  anchorChunks: (questionId: string) => ReadonlySet<string>
}

/** The set, without stale questions, and the chunks each question's anchors resolved to. */
function goldenOf(ctx: CommandContext, source: Source): Golden {
  const indexes = openIndexes(join(ctx.root, ctx.settings.dataDir), source.id, { create: false })
  try {
    const golden = readGoldenFiles(ctx.root, source.id, indexes.index)
    if (golden === undefined) throw new CliError(`${source.id} has no golden set`)
    const { questions, check } = golden
    const chunks = new Map(
      questions.map((question) => [
        question.id,
        new Set(
          [...question.primary, ...question.acceptable].flatMap((anchor) =>
            (check.lock.anchors[anchorKey(anchor)] ?? []).map(({ chunkId }) => chunkId),
          ),
        ),
      ]),
    )
    return {
      questions: questions.filter((question) => !check.stale.includes(question.id)),
      anchorChunks: (id) => chunks.get(id) ?? new Set(),
    }
  } finally {
    indexes.close()
  }
}

export function parseRows(text: string | undefined): AnswerRow[] {
  if (text === undefined) return [...ANSWER_ROWS]
  return text.split(',').map((part) => {
    const row = ANSWER_ROWS.find((known) => String(known) === part.trim())
    if (row === undefined) {
      throw new CliError(`--rows takes ${ANSWER_ROWS.join(', ')}, got "${part}"`)
    }
    return row
  })
}

export interface EvalAnswersArgs {
  source: string
  name: string | undefined
  rows: AnswerRow[]
  /** Only these questions, for a pilot. */
  only: string[] | undefined
  noise: boolean
  maxUsd: number | undefined
  yes: boolean
}

/** `drl eval answers`: answer the set under each row, judge the answers, and write a report. */
export async function evalAnswersCommand(
  ctx: CommandContext,
  args: EvalAnswersArgs,
): Promise<void> {
  const source = findSource(ctx.sources, args.source)
  const { settings } = ctx
  if (
    args.name !== undefined &&
    (args.only !== undefined || args.rows.length < ANSWER_ROWS.length)
  ) {
    throw new CliError('a named run answers the whole set under every row')
  }
  const golden = goldenOf(ctx, source)
  const questions =
    args.only === undefined
      ? golden.questions
      : args.only.map((id) => {
          const question = golden.questions.find((candidate) => candidate.id === id)
          if (question === undefined) throw new CliError(`there is no scored question ${id}`)
          return question
        })
  const maxUsd = args.maxUsd ?? settings.evalAnswers.maxUsd
  const client = clientOf(ctx)
  const answer = {
    model: settings.models.answer,
    effort: settings.answer.effort,
    maxTokens: settings.answer.maxTokens,
  }
  const judge = { model: settings.models.judge, ...settings.evalAnswers.judge }

  await withEvalCache(ctx, async (cache) => {
    const jobs = await planAnswers({
      engine: ctx.engine,
      sourceId: source.id,
      questions,
      rows: args.rows,
      noise: args.noise,
      settings: answer,
      meter: ctx.meter,
    })
    const estimate = await estimateCost({
      jobs,
      client,
      cache,
      pricing: settings.pricing,
      answerModel: answer.model,
      judge,
      retest: args.noise,
    })
    ctx.out.write(`${formatCostEstimate(estimate, maxUsd)}\n`)
    if (estimate.usd > maxUsd) {
      throw new CliError(
        `the estimate is over the limit of $${maxUsd.toFixed(2)}: raise --max-usd only if that is what you want`,
      )
    }
    if (!args.yes) {
      ctx.out.write('no paid call was made: add --yes to run this\n')
      return
    }

    // Fails before any paid call if the tree or the golden set cannot make this report.
    const report = await measure(ctx, source, args.name ?? null, undefined)
    let lastProgress = 0
    const runner = (label: string): RunnerOptions => ({
      client,
      cache,
      pricing: settings.pricing,
      meter: ctx.meter,
      maxUsd,
      concurrency: settings.evalAnswers.concurrency,
      onProgress: (done, total, usd) => {
        if (done === total || ctx.now() - lastProgress > 20_000) {
          lastProgress = ctx.now()
          ctx.out.write(`${label}: ${String(done)} of ${String(total)}, $${usd.toFixed(4)} paid\n`)
        }
      },
    })
    const answers = await runAnswers(jobs, runner('answers'))
    const byId = new Map(questions.map((question) => [question.id, question]))
    const { verdicts, support } = await runJudge(answers, {
      ...runner('judge'),
      judge,
      questions: byId,
      retest: args.noise,
    })
    const options = { questions, answers, verdicts, support, anchorChunks: golden.anchorChunks }
    const rows = [
      ...args.rows.map((row) => rowResult(row, 1, options)),
      ...(args.noise && args.rows.includes(3) ? [rowResult(3, 2, options)] : []),
    ]
    const comparisons = [
      ...(args.rows.includes(2) && args.rows.includes(3)
        ? [compareRows({ row: 2, sample: 1 }, { row: 3, sample: 1 }, options)]
        : []),
      ...(args.rows.includes(0) && args.rows.includes(3)
        ? [compareRows({ row: 0, sample: 1 }, { row: 3, sample: 1 }, options)]
        : []),
      ...(args.noise && args.rows.includes(3)
        ? [compareRows({ row: 3, sample: 1 }, { row: 3, sample: 2 }, options)]
        : []),
    ]
    const section: EvalAnswers = {
      models: { answer: answer.model, judge: judge.model },
      prompts: {
        answer: promptHash(ANSWER_SYSTEM_PROMPT),
        noRag: promptHash(noRagSystemPrompt(source.id)),
        correctness: promptHash(CORRECTNESS_SYSTEM_PROMPT),
        refusal: promptHash(REFUSAL_SYSTEM_PROMPT),
        support: promptHash(SUPPORT_SYSTEM_PROMPT),
      },
      rows,
      comparisons,
      judgeRetest: judgeRetest(verdicts),
      candidates: anchorCandidates(options, (id) => report.result.chunks[id]?.docPath ?? ''),
      paidUsd: ctx.meter.estimateCost(settings.pricing).total,
      answers,
      verdicts,
      support,
    }
    const judgeLine = judgeSentence(judgeTrust(section, readCalibrations(ctx.root, source.id)))
    const failures =
      answers.filter(({ status }) => status === 'failed').length +
      verdicts.filter(({ status }) => status === 'failed').length +
      support.filter(({ status }) => status === 'failed').length
    if (failures > 0 && args.name !== undefined) {
      throw new CliError(
        `${String(failures)} calls failed, and a named report needs them all: rerun, which pays only for those`,
      )
    }
    const path = writeReport(ctx, source, args.name, { ...report, answers: section }, (written) =>
      answerSections(written, judgeLine),
    )
    ctx.out.write(`${formatAnswersSummary(section, judgeLine)}\n\nreport: ${path}\n`)
    if (failures > 0) {
      throw new CliError(
        `${String(failures)} calls failed, so the report leaves those out: rerun, which pays only for them`,
      )
    }
  })
}

/** `drl eval judge-check`: grades answers whose grade is known. */
export async function evalJudgeCheckCommand(
  ctx: CommandContext,
  args: { source: string; yes: boolean },
): Promise<void> {
  const source = findSource(ctx.sources, args.source)
  const { settings } = ctx
  const cases = judgeCases(goldenOf(ctx, source).questions, {
    model: settings.models.judge,
    ...settings.evalAnswers.judge,
  })
  if (!args.yes) {
    ctx.out.write(
      `this would make up to ${String(cases.length)} calls to ${settings.models.judge}: add --yes to run them\n`,
    )
    return
  }
  await withEvalCache(ctx, async (cache) => {
    const results = await runJudgeCheck(cases, {
      client: clientOf(ctx),
      cache,
      pricing: settings.pricing,
      meter: ctx.meter,
      maxUsd: settings.evalAnswers.maxUsd,
      concurrency: settings.evalAnswers.concurrency,
    })
    ctx.out.write(`${formatJudgeCheck(results)}\n`)
    if (results.some((result) => !result.passed)) {
      throw new CliError('the judge cannot be trusted until these cases pass')
    }
  })
}

function reportWithAnswers(ctx: CommandContext, path: string) {
  const report = readReport(ctx.root, path)
  if (report.answers === undefined) {
    throw new CliError(`${path} has no answers: make it with drl eval answers`)
  }
  return { report, answers: report.answers }
}

function sampleOf(report: EvalReport, answers: EvalAnswers, golden: Golden) {
  return sampleForLabels({
    rows: [...new Set(answers.answers.map((answer) => answer.row))].sort(),
    answers: answers.answers,
    verdicts: answers.verdicts,
    questions: golden.questions,
  })
}

/** The second round's sample: fresh answers, with the first round's questions left out. */
function freshSampleOf(ctx: CommandContext, answers: EvalAnswers, golden: Golden, earlier: string) {
  const first = reportWithAnswers(ctx, earlier)
  return freshSampleForLabels({
    rows: [...new Set(answers.answers.map((answer) => answer.row))].sort(),
    answers: answers.answers,
    verdicts: answers.verdicts,
    questions: golden.questions,
    exclude: sampleOf(first.report, first.answers, golden),
  })
}

/** `drl eval label <report>`: writes the sheet a human labels from. It shows no verdicts. */
export function evalLabelCommand(
  ctx: CommandContext,
  args: { path: string; after: string | undefined },
): void {
  const { report, answers } = reportWithAnswers(ctx, args.path)
  const source = findSource(ctx.sources, report.identity.sourceId)
  const golden = goldenOf(ctx, source)
  const fresh = args.after !== undefined
  const sample =
    args.after !== undefined
      ? freshSampleOf(ctx, answers, golden, args.after)
      : sampleOf(report, answers, golden)
  const dir = join(reportsDir(ctx.root, source.id), 'dev')
  mkdirSync(dir, { recursive: true })
  const sheet = join(dir, `labels-${basename(args.path, '.json')}${fresh ? '-fresh' : ''}.md`)
  const questions = new Map(golden.questions.map((question) => [question.id, question]))
  writeFileSync(
    sheet,
    `${formatLabelSheet(sample, questions, sampleHash(sample), { correctnessOnly: fresh })}\n`,
  )
  ctx.out.write(`${String(sample.length)} answers to label, with no verdicts in sight: ${sheet}\n`)
}

/** One line of the labels file: the item on the sheet, and what the human said. */
interface LabelLine {
  item: number
  correctness?: 0 | 1 | 2
  /** A question the docs answer, and this answer refuses it. Left out when it does not. */
  refused?: boolean
  outcome?: AnswerLabel['outcome']
  supported?: boolean
}

interface LabelFile {
  /** The sample the sheet showed, so that labels cannot be read against another one. */
  sample: string
  labels: LabelLine[]
}

/** `drl eval calibrate <report> <labels>`: how often the human and the judge agree. */
export function evalCalibrateCommand(
  ctx: CommandContext,
  args: { path: string; labels: string; after: string | undefined; sampleOf: string | undefined },
): void {
  if (args.after !== undefined && args.sampleOf !== undefined) {
    throw new CliError('--after and --sample-of cannot go together')
  }
  const { report, answers } = reportWithAnswers(ctx, args.path)
  const source = findSource(ctx.sources, report.identity.sourceId)
  const golden = goldenOf(ctx, source)
  // The sample comes from a fixed seed, so the item numbers need no key next to them. For an
  // earlier round graded again, it is that report's sample, and this report's verdicts.
  const earlier = args.sampleOf === undefined ? undefined : reportWithAnswers(ctx, args.sampleOf)
  const sample =
    args.after !== undefined
      ? freshSampleOf(ctx, answers, golden, args.after)
      : earlier !== undefined
        ? sampleOf(earlier.report, earlier.answers, golden)
        : sampleOf(report, answers, golden)
  const full = resolve(ctx.root, args.labels)
  if (!existsSync(full)) throw new CliError(`no labels at ${full}`)
  const file = JSON.parse(readFileSync(full, 'utf8')) as LabelFile
  const hash = sampleHash(sample)
  if (file.sample !== hash) {
    throw new CliError(
      `these labels are of sample ${file.sample}, and this report gives ${hash}: they would be read against other answers`,
    )
  }
  const items = file.labels.map(({ item }) => item).sort((a, b) => a - b)
  const missing = sample.map((_, i) => i + 1).filter((item) => !items.includes(item))
  if (missing.length > 0 || new Set(items).size !== items.length) {
    throw new CliError(
      `every item needs one label: ${missing.length > 0 ? `${missing.join(', ')} missing` : 'one appears twice'}`,
    )
  }
  const labels = file.labels.map((line): AnswerLabel => {
    const answer = sample[line.item - 1]
    if (answer === undefined) throw new CliError(`there is no item ${String(line.item)}`)
    const question = golden.questions.find(({ id }) => id === answer.questionId)
    if (question === undefined) throw new CliError(`no question ${answer.questionId}`)
    const unanswerable = isUnanswerable(question)
    if (unanswerable ? line.outcome === undefined : line.correctness === undefined) {
      throw new CliError(
        `item ${String(line.item)} needs ${unanswerable ? 'an outcome' : 'a correctness'}`,
      )
    }
    if (unanswerable && line.refused !== undefined) {
      throw new CliError(`item ${String(line.item)} takes an outcome, not refused`)
    }
    if (line.refused === true && line.correctness !== 0) {
      throw new CliError(`item ${String(line.item)} is refused, and a refusal scores 0`)
    }
    return {
      questionId: answer.questionId,
      row: answer.row,
      correctness: unanswerable ? null : (line.correctness ?? null),
      refused: unanswerable ? null : (line.refused ?? false),
      outcome: unanswerable ? (line.outcome ?? null) : null,
      supported: line.supported ?? null,
    }
  })
  const calibration = calibrate({
    report: {
      repoSha: report.run.repoSha,
      name: report.run.name,
      createdAt: report.run.createdAt,
    },
    labels,
    verdicts: answers.verdicts,
    support: answers.support,
    blind: earlier === undefined,
    prompts: answers.prompts,
    ...(args.after === undefined ? {} : { dimensions: ['correctness'] as const }),
  })
  // Next to the report, where JSON is recorded data (ADR-0010).
  const round = args.after !== undefined ? '-fresh' : earlier !== undefined ? '-not-blind' : ''
  const stem = `${resolve(ctx.root, args.path).replace(/\.json$/, '')}-calibration${round}`
  writeFileSync(`${stem}.json`, `${JSON.stringify(calibration, null, 2)}\n`)
  const text = formatCalibration(calibration)
  writeFileSync(`${stem}.md`, text)
  ctx.out.write(text)
}
