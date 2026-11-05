// drl eval answers, label, calibrate and judge-check: answer metrics (SPEC section 10,
// ADR-0012). These are the eval commands that spend money, so each prints an estimate first,
// and none makes a paid call without --yes.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

import {
  ANSWER_ROWS,
  STRATEGIES,
  type AnswerLabel,
  type AnswerRow,
  type EvalAnswer,
  type EvalAnswers,
  type EvalReport,
  type EvalSpotCheck,
} from '@docs-rag-lab/contracts'
import {
  anchorCandidates,
  anchorKey,
  calibrate,
  checkVariantIndex,
  compareRows,
  createClaudeClient,
  CORRECTNESS_SYSTEM_PROMPT,
  estimateCost,
  freshSampleForLabels,
  isUnanswerable,
  judgeSentence,
  judgeTrust,
  listRuns,
  newRowsSampleForLabels,
  NOISE_ROWS,
  readCalibrations,
  readRun,
  reportSources,
  judgeCases,
  judgeRetest,
  noRagSystemPrompt,
  openEvalCache,
  openIndexes,
  planAnswers,
  promptHash,
  REFUSAL_SYSTEM_PROMPT,
  ROW_STRATEGY,
  ROW_VARIANT,
  rowResult,
  runAnswers,
  runJudge,
  runJudgeCheck,
  sampleForLabels,
  sampleHash,
  spotCheck,
  spotCheckPath,
  spotCheckSampleForLabels,
  readSourceAbout,
  spotCheckSentence,
  readSpotCheck,
  SPOT_CHECK_ANSWERS,
  spotCheckPlanFor,
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
  formatSpotCheck,
  formatCostEstimate,
  formatJudgeCheck,
  formatLabelSheet,
} from './eval-answers-format.ts'
import {
  checkRunName,
  measure,
  readReport,
  reportMarkdown,
  reportsDir,
  writeReport,
} from './eval-commands.ts'
import { durationOf, planRerankRun } from './eval-rerank.ts'
import { readGoldenFiles, readGoldenLock } from './golden.ts'

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

/**
 * The set, without stale questions, and the chunks each question's anchors resolved to. A report's
 * commands pass the set it names. The compiled index has chunks of its own, so its lock's anchors
 * count too: row 7 cites them (ADR-0017).
 */
function goldenOf(ctx: CommandContext, source: Source, setHash?: string): Golden {
  const indexes = openIndexes(join(ctx.root, ctx.settings.dataDir), source.id, { create: false })
  try {
    const golden = readGoldenFiles(ctx.root, source.id, indexes.index, { setHash })
    if (golden === undefined) throw new CliError(`${source.id} has no golden set`)
    const { questions, check } = golden
    const compiled = readGoldenLock(ctx.root, source.id, { setHash, variant: 'compiled' })
    const locks = [check.lock, ...(compiled?.setHash === check.lock.setHash ? [compiled] : [])]
    const chunks = new Map(
      questions.map((question) => [
        question.id,
        new Set(
          [...question.primary, ...question.acceptable].flatMap((anchor) =>
            locks.flatMap((lock) =>
              (lock.anchors[anchorKey(anchor)] ?? []).map(({ chunkId }) => chunkId),
            ),
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

/** Rows 4 and 5 take up to a minute a question on the free trial, so they are asked for by name. */
const DEFAULT_ROWS: readonly AnswerRow[] = [0, 2, 3]

/** Pairs a report compares when it has both rows. Rows 4, 5 and 7 are measured against row 3. */
const COMPARED_ROWS: readonly (readonly [AnswerRow, AnswerRow])[] = [
  [2, 3],
  [0, 3],
  [3, 4],
  [3, 5],
  [4, 5],
  [3, 7],
]

export function parseRows(text: string | undefined): AnswerRow[] {
  if (text === undefined) return [...DEFAULT_ROWS]
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

/** The index row 5 reads, checked against the plain one before anything is spent. */
function contextualIndexOf(
  ctx: CommandContext,
  source: Source,
  rows: readonly AnswerRow[],
): EvalAnswers['contextualIndex'] {
  const reading = rows.filter((row) => ROW_VARIANT[row] === 'contextual')
  if (reading.length === 0) return undefined
  const dataDir = join(ctx.root, ctx.settings.dataDir)
  const indexes = openIndexes(dataDir, source.id, { create: false, variant: 'contextual' })
  try {
    const plain = openIndexes(dataDir, source.id, { create: false })
    try {
      const { problems } = checkVariantIndex(plain.index, indexes.index, 'contextual')
      if (problems.length > 0) {
        throw new CliError(`the contextual index differs:\n${problems.join('\n')}`)
      }
    } finally {
      plain.close()
    }
    const contextModel = indexes.index.getManifest()?.contextModel
    if (contextModel == null) throw new CliError('the contextual index names no context model')
    return { rows: reading, contextModel, chunksHash: indexes.index.chunksHash() }
  } finally {
    indexes.close()
  }
}

/**
 * The index row 7 reads (ADR-0017). Its chunks are its own, so it is checked against its own lock,
 * which has to be clean before anything is spent.
 */
function compiledIndexOf(
  ctx: CommandContext,
  source: Source,
  rows: readonly AnswerRow[],
): EvalAnswers['compiledIndex'] {
  const reading = rows.filter((row) => ROW_VARIANT[row] === 'compiled')
  if (reading.length === 0) return undefined
  const indexes = openIndexes(join(ctx.root, ctx.settings.dataDir), source.id, {
    create: false,
    variant: 'compiled',
  })
  try {
    const check = readGoldenFiles(ctx.root, source.id, indexes.index, {
      variant: 'compiled',
    })?.check
    if (check === undefined) throw new CliError(`${source.id} has no golden set`)
    if (check.setChanged || check.findings.length > 0 || check.docsMovedFrom !== undefined) {
      throw new CliError(
        'row 7 reads the compiled index, whose golden check is not clean: run drl eval check --compiled first',
      )
    }
    const compiler = indexes.index.getManifest()?.contextModel
    if (compiler == null) throw new CliError('the compiled index names no compiler')
    return { rows: reading, compiler, chunksHash: indexes.index.chunksHash() }
  } finally {
    indexes.close()
  }
}

/** The rerank calls these rows and questions still need. They are free, and they take a while. */
async function missingRerankCalls(
  ctx: CommandContext,
  source: Source,
  rows: readonly AnswerRow[],
  questions: readonly GoldenQuestion[],
): Promise<{ calls: number; estimatedTokens: number }> {
  const variants = new Set(
    rows.filter((row) => ROW_STRATEGY[row] === 'rerank').map((row) => ROW_VARIANT[row]),
  )
  const missing = { calls: 0, estimatedTokens: 0 }
  for (const variant of variants) {
    const plan = await planRerankRun(ctx, source.id, variant, questions)
    missing.calls += plan.calls
    missing.estimatedTokens += plan.estimatedTokens
  }
  return missing
}

/** `drl eval answers`: answer the set under each row, judge the answers, and write a report. */
export async function evalAnswersCommand(
  ctx: CommandContext,
  args: EvalAnswersArgs,
): Promise<void> {
  const source = findSource(ctx.sources, args.source)
  const { settings } = ctx
  checkRunName(args.name)
  if (
    args.name !== undefined &&
    (args.only !== undefined || !DEFAULT_ROWS.every((row) => args.rows.includes(row)))
  ) {
    throw new CliError(
      `a named run answers the whole set under every row, at least ${DEFAULT_ROWS.join(', ')}`,
    )
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
  const contextualIndex = contextualIndexOf(ctx, source, args.rows)
  const compiledIndex = compiledIndexOf(ctx, source, args.rows)
  if (!args.yes) {
    const { calls, estimatedTokens } = await missingRerankCalls(ctx, source, args.rows, questions)
    if (calls > 0) {
      ctx.out.write(
        `this would first make ${String(calls)} calls to ${settings.rerank.model}, about ${estimatedTokens.toLocaleString('en-US')} estimated tokens and ${durationOf(ctx, calls, estimatedTokens)} at the free-trial limits, and only then show the estimate of the paid calls: add --yes for both, or take a pilot of these questions with --only\n`,
      )
      return
    }
  }
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
      engineFor: ctx.engineFor,
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
    // A named run says what row 4 retrieved too. A pilot stays quick.
    const reranks = args.rows.some((row) => ROW_STRATEGY[row] === 'rerank')
    const report = await measure(
      ctx,
      source,
      args.name ?? null,
      args.name !== undefined && reranks ? STRATEGIES : undefined,
    )
    let lastProgress = 0
    const runner = (label: string): RunnerOptions => ({
      client,
      cache,
      pricing: settings.pricing,
      meter: ctx.meter,
      maxUsd,
      concurrency: settings.evalAnswers.concurrency,
      guard: ctx.guard,
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
    const twice = args.noise ? args.rows.filter((row) => NOISE_ROWS.includes(row)) : []
    const rows = [
      ...args.rows.map((row) => rowResult(row, 1, options)),
      ...twice.map((row) => rowResult(row, 2, options)),
    ]
    const comparisons = [
      ...COMPARED_ROWS.filter(([a, b]) => args.rows.includes(a) && args.rows.includes(b)).map(
        ([a, b]) => compareRows({ row: a, sample: 1 }, { row: b, sample: 1 }, options),
      ),
      ...twice.map((row) => compareRows({ row, sample: 1 }, { row, sample: 2 }, options)),
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
      ...(contextualIndex === undefined ? {} : { contextualIndex }),
      ...(compiledIndex === undefined ? {} : { compiledIndex }),
      paidUsd: ctx.meter.estimateCost(settings.pricing).total,
      answers,
      verdicts,
      support,
    }
    const calibrations = readCalibrations(ctx.root)
    const judgeLine = judgeSentence(
      judgeTrust(section, calibrations.rounds, calibrations.unreadable, source.id),
    )
    const failures =
      answers.filter(({ status }) => status === 'failed').length +
      verdicts.filter(({ status }) => status === 'failed').length +
      support.filter(({ status }) => status === 'failed').length
    if (failures > 0 && args.name !== undefined) {
      throw new CliError(
        `${String(failures)} calls failed, and a named report needs them all: rerun, which pays only for those`,
      )
    }
    await ctx.guard?.check()
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
      guard: ctx.guard,
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

/** The round for rows new in a milestone, from their first answers. */
function newRowsSampleOf(answers: EvalAnswers, golden: Golden, rows: readonly AnswerRow[]) {
  return newRowsSampleForLabels({
    rows,
    answers: answers.answers,
    verdicts: answers.verdicts,
    questions: golden.questions,
  })
}

/**
 * The spot check's sample: ADR-0017's for a report with row 7, and ADR-0016's otherwise. It needs
 * the rows it takes its answers from.
 */
function spotCheckSampleOf(answers: EvalAnswers, golden: Golden) {
  const present = new Set(answers.answers.map(({ row }) => row))
  const plan = spotCheckPlanFor(present)
  const missing = plan.rows.filter((row) => !present.has(row))
  if (missing.length > 0) {
    throw new CliError(
      `a spot check takes answers from rows ${[...plan.rows].sort().join(', ')}, and this report has no row ${missing.join(', ')}`,
    )
  }
  return spotCheckSampleForLabels(
    {
      answers: answers.answers,
      verdicts: answers.verdicts,
      questions: golden.questions,
    },
    plan,
  )
}

/** `drl eval label <report>`: writes the sheet a human labels from. It shows no verdicts. */
export function evalLabelCommand(
  ctx: CommandContext,
  args: {
    path: string
    after: string | undefined
    rows?: readonly AnswerRow[] | undefined
    spot?: boolean
  },
): void {
  const { report, answers } = reportWithAnswers(ctx, args.path)
  const source = findSource(ctx.sources, report.identity.sourceId)
  const golden = goldenOf(ctx, source, report.identity.goldenSet.hash)
  const fresh = args.after !== undefined
  const spot = args.spot === true
  if (fresh && args.rows !== undefined) throw new CliError('--after and --rows cannot go together')
  if (spot && (fresh || args.rows !== undefined)) {
    throw new CliError('--spot goes with neither --after nor --rows')
  }
  const sample = spot
    ? spotCheckSampleOf(answers, golden)
    : args.rows !== undefined
      ? newRowsSampleOf(answers, golden, args.rows)
      : args.after !== undefined
        ? freshSampleOf(ctx, answers, golden, args.after)
        : sampleOf(report, answers, golden)
  if (spot && sample.length < SPOT_CHECK_ANSWERS) {
    ctx.out.write(
      `this report has too few questions for ${String(SPOT_CHECK_ANSWERS)} answers, so the sheet has ${String(sample.length)}\n`,
    )
  }
  const dir = join(reportsDir(ctx.root, source.id), 'dev')
  mkdirSync(dir, { recursive: true })
  const round = spot ? '-spot-check' : fresh ? '-fresh' : args.rows !== undefined ? '-new-rows' : ''
  const sheet = join(dir, `labels-${basename(args.path, '.json')}${round}.md`)
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

/** A labels file, read against the sample it says it is of. */
function readLabels(
  ctx: CommandContext,
  path: string,
  sample: readonly EvalAnswer[],
  golden: Golden,
): AnswerLabel[] {
  const full = resolve(ctx.root, path)
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
  return file.labels.map((line): AnswerLabel => {
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
}

const spotCheckWords = (spot: EvalSpotCheck | null): string[] =>
  spot === null ? [] : [spotCheckSentence(spot)]

/**
 * `drl eval spot-check <report> <labels>`: the judge on a new source's answers (ADR-0016). Its file
 * is next to the report, and nothing that decides calibration reads it.
 */
export function evalSpotCheckCommand(
  ctx: CommandContext,
  args: { path: string; labels: string },
): void {
  const { report, answers } = reportWithAnswers(ctx, args.path)
  const source = findSource(ctx.sources, report.identity.sourceId)
  const golden = goldenOf(ctx, source, report.identity.goldenSet.hash)
  const sample = spotCheckSampleOf(answers, golden)
  const found = spotCheck({
    report: {
      repoSha: report.run.repoSha,
      name: report.run.name,
      createdAt: report.run.createdAt,
    },
    labels: readLabels(ctx, args.labels, sample, golden),
    verdicts: answers.verdicts,
    support: answers.support,
    prompts: answers.prompts,
    judgeModel: answers.models.judge,
  })
  const path = spotCheckPath(resolve(ctx.root, args.path))
  writeFileSync(path, `${JSON.stringify(found, null, 2)}\n`)
  const text = formatSpotCheck(found)
  writeFileSync(path.replace(/\.json$/, '.md'), text)
  ctx.out.write(text)
  rewriteAnswerMarkdown(ctx)
}

/** `drl eval calibrate <report> <labels>`: how often the human and the judge agree. */
export function evalCalibrateCommand(
  ctx: CommandContext,
  args: {
    path: string
    labels: string
    after: string | undefined
    sampleOf: string | undefined
    rows?: readonly AnswerRow[] | undefined
  },
): void {
  if (args.after !== undefined && args.sampleOf !== undefined) {
    throw new CliError('--after and --sample-of cannot go together')
  }
  if (args.rows !== undefined && (args.after !== undefined || args.sampleOf !== undefined)) {
    throw new CliError('--rows goes with neither --after nor --sample-of')
  }
  const { report, answers } = reportWithAnswers(ctx, args.path)
  const source = findSource(ctx.sources, report.identity.sourceId)
  const golden = goldenOf(ctx, source, report.identity.goldenSet.hash)
  // The sample comes from a fixed seed, so the item numbers need no key next to them. For an
  // earlier round graded again, it is that report's sample, and this report's verdicts.
  const earlier = args.sampleOf === undefined ? undefined : reportWithAnswers(ctx, args.sampleOf)
  const sample =
    args.rows !== undefined
      ? newRowsSampleOf(answers, golden, args.rows)
      : args.after !== undefined
        ? freshSampleOf(ctx, answers, golden, args.after)
        : earlier !== undefined
          ? sampleOf(earlier.report, earlier.answers, golden)
          : sampleOf(report, answers, golden)
  const labels = readLabels(ctx, args.labels, sample, golden)
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
    judgeModel: answers.models.judge,
    ...(args.after === undefined ? {} : { dimensions: ['correctness'] as const }),
  })
  // Next to the report, where JSON is recorded data (ADR-0010).
  const round = args.after !== undefined ? '-fresh' : earlier !== undefined ? '-not-blind' : ''
  const stem = `${resolve(ctx.root, args.path).replace(/\.json$/, '')}-calibration${round}`
  writeFileSync(`${stem}.json`, `${JSON.stringify(calibration, null, 2)}\n`)
  const text = formatCalibration(calibration)
  writeFileSync(`${stem}.md`, text)
  ctx.out.write(text)
  rewriteAnswerMarkdown(ctx)
  const calibrations = readCalibrations(ctx.root)
  const named = listRuns(ctx.root, source.id).runs.some(
    ({ id }) => id === basename(args.path, '.json'),
  )
  ctx.out.write(
    named
      ? `\n${judgeSentence(judgeTrust(answers, calibrations.rounds, calibrations.unreadable, source.id))}\n`
      : '\nThis is a development report, so these labels count for no report the store reads.\n',
  )
}

/**
 * What a report's markdown says of the judge depends on the labels, which come after the report,
 * so new labels write it again, on every source (ADR-0013). The JSON, which is the record, is not
 * touched.
 */
function rewriteAnswerMarkdown(ctx: CommandContext): void {
  const { rounds, unreadable } = readCalibrations(ctx.root)
  for (const sourceId of reportSources(ctx.root)) {
    for (const { id, hasAnswers } of listRuns(ctx.root, sourceId).runs) {
      if (!hasAnswers) continue
      try {
        writeFileSync(
          join(reportsDir(ctx.root, sourceId), `${id}.md`),
          reportMarkdown(
            readRun(ctx.root, sourceId, id),
            (answers) =>
              answerSections(
                answers,
                [
                  judgeSentence(judgeTrust(answers, rounds, unreadable, sourceId)),
                  ...spotCheckWords(readSpotCheck(ctx.root, sourceId, id)),
                ].join(' '),
              ),
            readSourceAbout(ctx.root, sourceId).set,
          ),
        )
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        ctx.out.write(`\ncould not write ${id}.md again: ${reason}\n`)
      }
    }
  }
}
