import { parseArgs } from 'node:util'

import { STRATEGIES, type Strategy } from '@docs-rag-lab/contracts'
import {
  createEmbeddingProvider,
  createEngine,
  createRerankProvider,
  DOC_TYPES,
  EvalStoppedError,
  findRepoRoot,
  formatUsage,
  GoldenSetError,
  guardEmbeddings,
  guardReranker,
  IndexNotFoundError,
  InvalidRequestError,
  loadRootEnv,
  MAX_TOP_K,
  MissingKeyError,
  RerankRejectedError,
  RunMovedError,
  startRunGuard,
  UnknownSourceError,
  UsageMeter,
  type DocType,
  BankStoppedError,
  ContextsStoppedError,
  type EmbeddingProvider,
  type EvalClient,
  type IndexVariant,
  type RerankProvider,
  type Source,
} from '@docs-rag-lab/core'
import { settings as defaultSettings, type Settings } from '@docs-rag-lab/settings'
import { reactSource } from '@docs-rag-lab/source-react'
import { typescriptSource } from '@docs-rag-lab/source-typescript'

import {
  askCommand,
  evalCheckCommand,
  limitsCommand,
  searchCommand,
  syncCommand,
  type RetrievalArgs,
  type Writer,
} from './commands.ts'
import { CliError } from './errors.ts'
import {
  evalAnswersCommand,
  evalCalibrateCommand,
  evalSpotCheckCommand,
  evalJudgeCheckCommand,
  evalLabelCommand,
  parseRows,
} from './eval-answers.ts'
import { evalCompareCommand, evalRunCommand, evalVerifyCommand } from './eval-commands.ts'
import { evalDraftCheckCommand, evalWalkCommand, WALK_TOP } from './eval-draft.ts'
import { evalRerankCheckCommand } from './eval-rerank.ts'
import {
  questionsCommand,
  questionsFlaggedCommand,
  questionsRejectCommand,
  questionsSampleCommand,
  questionsScoreCommand,
  questionsUnflagCommand,
} from './questions.ts'
import { syncCompiledCommand } from './sync-compiled.ts'
import { syncContextualCommand, syncControlCommand } from './sync-contextual.ts'
import { formatDuration } from './format.ts'

export const USAGE = `Usage: drl <command> [options]

Commands:
  sync <source> [--full]      Sync, parse, chunk and embed a source (incremental by default)
      [--at <sha>]            Index this commit (a full SHA) instead of the head of the branch;
                              the next sync without it returns to the head
      [--contextual]          Build the contextual index instead, at the plain index's commit
                              (ADR-0014): Claude writes a context per chunk, kept under
                              eval/contexts/, and each chunk is embedded with its context.
                              Spends money: prints the estimate, and needs --yes to go on
      [--pilot <n>]           With --contextual: only write contexts for n chunks, and print
                              them with the forecast for the rest
      [--control]             Build its control instead: the same, with the prefix "title >
                              section path" from code, and no call to Claude. Needs --yes
      [--compiled]            Build the compiled index instead, at the plain index's commit
                              (ADR-0017): compiles every twoslash example, records what did not
                              compile under eval/compile/, stops below 90% compiled, and prints
                              what it would embed. Needs --yes to build it
  questions <source>          The interview bank of a source (ADR-0018): writes its compiler
                              questions, which cost nothing, to interview/bank/, then prints
                              the estimate of the generated ones. Needs --yes to write them
      [--pilot <n>]           Only n chunks, and print their questions with the forecast
  questions sample            The sheet of M8's test: 20 generated questions, with no verdict
  questions score <labels>    How many of those questions pass the owner's labels
  questions flagged           The cards flagged as wrong in the interview-prep app, with the
                              reason and what the bank says of each
  questions unflag <id>       Take a flag back: the app shows the card again
  questions reject <id> [reason]
                              The owner found a shown question wrong: it stays in its bank
                              with the reason, and the app no longer shows it. With no
                              reason, the one given when it was flagged in the app
  ask "<question>"            Answer from the docs with cited sources
      [--verbose]             Print the retrieval trace before the answer
  search "<question>"         Retrieval only, no answer: print the retrieval trace
      [--json]                Print the whole trace as JSON (the usage line goes to stderr)
  limits                      Show the rate-limit headers of embeddings and of rerank
                              (one tiny request each)
  eval                        Retrieval metrics over the golden set, written as a report.
                              No Claude call. Without --name it is a development run
      [--name <name>]         A run to keep, such as baseline: needs a clean tree and check.
                              It measures every strategy, rerank too, one paced call per question
      [--strategy <s>]        One strategy instead of vector and hybrid
      [--contextual]          Measure the contextual index instead of the plain one
      [--control]             Measure the control index, under vector and hybrid only
      [--compiled]            Measure the compiled index, with the twoslash output (ADR-0017)
      [--yes]                 Go on with rerank calls that are not cached: without it, a run
                              that needs them prints their estimate and stops
  eval verify <report>        Run a report again, and say whether it reproduces
      [--record]              Write what it found next to the report, for the dashboard
  eval answers                Answer the set under each row and judge the answers. Spends
                              money: prints the estimate, and needs --yes to go on
      [--rows <list>]         Rows of the ladder: 0, 2 and 3 by default, and 4, rerank, 5,
                              rerank on the contextual index, or 7, hybrid on the compiled
                              index, when asked for
      [--only <ids>]          Only these questions, for a pilot
      [--noise]               Answer rows 3, 4, 5 and 7 twice, and ask the judge twice about row
                              3, to measure noise
      [--max-usd <n>]         Stop before the next paid call past this
      [--name <name>]         A run to keep: the whole set, every row, a clean tree
  eval judge-check            Grade answers whose grade is known. Needs --yes
  eval rerank-check           How a rerank score depends on the rest of its call, compared
                              exactly (ADR-0014). Uses free tokens, and needs --yes to go on
  eval label <report>         Write the sheet a human labels from, with no verdicts
      [--after <report>]      A fresh round: 10 answers, on no question of that report's sheet
      [--rows <list>]         A round on those rows: 15 answers, for rows new in a milestone
      [--spot]                A spot check: 10 answers from rows 0, 3 and 4 (ADR-0016), or 0,
                              3 and 7 for a report with row 7 (ADR-0017). With --after, a fresh
                              one: 5 from row 3 and 5 from row 7 on the error codes, none that
                              report's spot check showed (ADR-0017)
  eval calibrate <r> <labels> How often the human and the judge agree
      [--after <report>]      Those labels are of a fresh round after that report
      [--sample-of <report>]  Those labels are of that report's sheet, graded again: not blind
      [--rows <list>]         Those labels are of a round on those rows
  eval spot-check <r> <labels> How often the human and the judge agree on a spot check, which
                              decides nothing for any other report
      [--after <report>]      Those labels are of a fresh spot check after that report
  eval compare <a> <b>        Compare two reports question by question, and mark what is noise
      [--strategies <x>,<y>]  a's strategy x against b's strategy y, instead of like with like
      [--without-tag <tag>]   Leave out the questions with that tag (ADR-0017)
  eval check [--source <id>]  Check the golden set against the index (no API calls): which
                              questions are stale, and which anchors changed since the lock
      [--accept]              After reviewing them, record what the anchors resolve to now
      [--set-version <n>]     With --accept: the new version of a set that changed (ADR-0009)
      [--contextual]          That index, also against the plain one's chunks
      [--control]             That index, also against the plain one's chunks
      [--compiled]            That index, against a lock of its own: with --accept, it records
                              that lock, at the version the plain lock records
      [--draft]               questions.draft.jsonl instead: which anchors do not resolve,
                              what each question copies from the docs, and fails above 2
                              fresh questions on a page (ADR-0016)
  eval walk                   Every indexed page and heading, newest first by git history, at
                              the index's commit, to pick fresh questions from (ADR-0016).
                              Clones the docs' history once, under the cache
      [--top <n>]             How many to print (default: ${String(WALK_TOP)})

Retrieval options (ask and search):
  --source <id>               The source to search (default: the first in settings)
  --strategy <s>              vector: vector search only. hybrid: vector + keyword search fused
                              by RRF. rerank: hybrid with its top reranked, one paced call that
                              takes up to a minute on the free trial
                              (default: retrieval.strategy in settings)
  --doc-type <type>           Only chunks of this doc type; repeat it or separate with commas:
                              ${DOC_TYPES.join(', ')}
  --top-k <n>                 Chunks that go to the answer, 1 to 100 (default: retrieval.topK)

Options:
  -h, --help                  Show this help

API keys come from the environment or from .env at the repository root.
Every command that calls an API ends with its token usage and estimated cost.
Set DRL_DEBUG=1 to print stack traces of failures.
`

/** More than any golden set will reach; it only keeps the flag's error message sensible. */
const MAX_SET_VERSION = 9999
/** A pilot is a look at the prompt and the cost, not a first part of the run. */
const MAX_PILOT = 50
/** More than the pages and headings of any source here. */
const MAX_WALK = 100_000

/**
 * The Source objects for the configured sources. Settings hold their options as data. The first
 * is what `--source` defaults to, so TypeScript stays first.
 */
export function sourcesFor(settings: Settings): Source[] {
  return [typescriptSource(settings.sources.typescript), reactSource(settings.sources.react)]
}

export interface RunOptions {
  /** Defaults to @docs-rag-lab/settings. */
  settings?: Settings
  /** Defaults to sourcesFor(settings). */
  sources?: readonly Source[]
  out?: Writer
  err?: Writer
  root?: string
  now?: () => number
  /** Print stack traces of failures (default: DRL_DEBUG=1). */
  debug?: boolean
  /** For tests: the Claude client behind answer metrics. */
  createEvalClient?: () => EvalClient
  /** For tests: the reranker. */
  createReranker?: () => RerankProvider
  /** For tests: the embedding provider. */
  createProvider?: () => EmbeddingProvider
}

function positiveInteger(
  value: string | undefined,
  fallback: number,
  name: string,
  max: number,
): number {
  if (value === undefined) return fallback
  const n = Number(value)
  if (!Number.isInteger(n) || n <= 0 || n > max) {
    throw new CliError(`${name} must be a whole number from 1 to ${String(max)}`)
  }
  return n
}

/** git fetches a commit by its full name only; a short SHA would fail with a less useful message. */
function commitOf(value: string | undefined): string | undefined {
  if (value !== undefined && !/^[0-9a-f]{40}$/.test(value)) {
    throw new CliError(`--at must be a full 40-character commit SHA, got "${value}"`)
  }
  return value
}

function strategyOf(value: string | undefined, fallback: Strategy): Strategy {
  if (value === undefined) return fallback
  const strategy = STRATEGIES.find((s) => s === value)
  if (strategy === undefined) {
    throw new CliError(`--strategy must be one of ${STRATEGIES.join(', ')}, got "${value}"`)
  }
  return strategy
}

/** `hybrid,rerank`: which strategy of each report to compare. */
function strategyPairOf(value: string | undefined): [Strategy, Strategy] | undefined {
  if (value === undefined) return undefined
  const parts = value.split(',').map((part) => part.trim())
  const [first, second] = parts
  if (parts.length !== 2 || first === undefined || second === undefined) {
    throw new CliError(`--strategies takes two strategies, such as hybrid,rerank, got "${value}"`)
  }
  const named = (name: string): Strategy => {
    const strategy = STRATEGIES.find((known) => known === name)
    if (strategy === undefined) {
      throw new CliError(`--strategies names ${STRATEGIES.join(', ')}, got "${name}"`)
    }
    return strategy
  }
  return [named(first), named(second)]
}

function docTypesOf(values: readonly string[] | undefined): DocType[] {
  const docTypes: DocType[] = []
  for (const value of (values ?? []).flatMap((v) => v.split(','))) {
    const name = value.trim()
    const docType = DOC_TYPES.find((d) => d === name)
    if (docType === undefined) {
      throw new CliError(`--doc-type must be one of ${DOC_TYPES.join(', ')}, got "${name}"`)
    }
    if (!docTypes.includes(docType)) docTypes.push(docType)
  }
  return docTypes
}

/** A flag another command takes would be ignored here, and the run would seem to honor it. */
function refuseStrayEvalFlags(
  subcommand: string | undefined,
  values: {
    accept: boolean
    name?: string | undefined
    strategy?: string | undefined
    record?: boolean | undefined
    after?: string | undefined
    'sample-of'?: string | undefined
    contextual?: boolean | undefined
    control?: boolean | undefined
    compiled?: boolean | undefined
    strategies?: string | undefined
    'without-tag'?: string | undefined
    rows?: string | undefined
    only?: string | undefined
    noise?: boolean | undefined
    spot?: boolean | undefined
    draft?: boolean | undefined
    top?: string | undefined
    'max-usd'?: string | undefined
    yes?: boolean | undefined
    'top-k'?: string | undefined
    'doc-type'?: string[] | undefined
  },
): void {
  const stray = [
    ...(values['top-k'] === undefined ? [] : ['--top-k']),
    ...(values['doc-type'] === undefined ? [] : ['--doc-type']),
    ...(values.accept && subcommand !== 'check' ? ['--accept'] : []),
    ...(values.name !== undefined && subcommand !== undefined && subcommand !== 'answers'
      ? ['--name']
      : []),
    ...(values.record === true && subcommand !== 'verify' ? ['--record'] : []),
    ...(values.contextual === true && subcommand !== undefined && subcommand !== 'check'
      ? ['--contextual']
      : []),
    ...(values.control === true && subcommand !== undefined && subcommand !== 'check'
      ? ['--control']
      : []),
    ...(values.compiled === true && subcommand !== undefined && subcommand !== 'check'
      ? ['--compiled']
      : []),
    ...(values.strategies !== undefined && subcommand !== 'compare' ? ['--strategies'] : []),
    ...(values['without-tag'] !== undefined && subcommand !== 'compare' ? ['--without-tag'] : []),
    ...(values.after !== undefined &&
    subcommand !== 'label' &&
    subcommand !== 'calibrate' &&
    subcommand !== 'spot-check'
      ? ['--after']
      : []),
    ...(values['sample-of'] !== undefined && subcommand !== 'calibrate' ? ['--sample-of'] : []),
    ...(values.spot === true && subcommand !== 'label' ? ['--spot'] : []),
    ...(values.draft === true && subcommand !== 'check' ? ['--draft'] : []),
    ...(values.top !== undefined && subcommand !== 'walk' ? ['--top'] : []),
    ...(values.rows !== undefined &&
    subcommand !== 'answers' &&
    subcommand !== 'label' &&
    subcommand !== 'calibrate'
      ? ['--rows']
      : []),
    ...(values.only !== undefined && subcommand !== 'answers' ? ['--only'] : []),
    ...(values.noise === true && subcommand !== 'answers' ? ['--noise'] : []),
    ...(values['max-usd'] !== undefined && subcommand !== 'answers' ? ['--max-usd'] : []),
    ...(values.yes === true &&
    subcommand !== undefined &&
    subcommand !== 'answers' &&
    subcommand !== 'judge-check' &&
    subcommand !== 'rerank-check'
      ? ['--yes']
      : []),
    ...(values.strategy !== undefined && subcommand !== undefined ? ['--strategy'] : []),
  ]
  if (stray.length > 0) {
    throw new CliError(`${stray.join(', ')} does not apply to drl eval ${subcommand ?? 'run'}`)
  }
}

/** Errors whose message says what to do; they need no stack trace. */
function isUsageError(error: unknown): boolean {
  return (
    error instanceof CliError ||
    error instanceof MissingKeyError ||
    error instanceof UnknownSourceError ||
    error instanceof IndexNotFoundError ||
    error instanceof InvalidRequestError ||
    error instanceof GoldenSetError ||
    error instanceof RerankRejectedError ||
    error instanceof RunMovedError ||
    error instanceof EvalStoppedError ||
    error instanceof ContextsStoppedError ||
    error instanceof BankStoppedError
  )
}

/** Runs one drl command and returns the process exit code. */
export async function run(argv: readonly string[], options: RunOptions = {}): Promise<number> {
  const out = options.out ?? process.stdout
  const err = options.err ?? process.stderr
  const now = options.now ?? (() => Date.now())
  const settings = options.settings ?? defaultSettings
  const sources = options.sources ?? sourcesFor(settings)

  let parsed
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: {
        full: { type: 'boolean', default: false },
        at: { type: 'string' },
        contextual: { type: 'boolean', default: false },
        control: { type: 'boolean', default: false },
        compiled: { type: 'boolean', default: false },
        pilot: { type: 'string' },
        accept: { type: 'boolean', default: false },
        'set-version': { type: 'string' },
        name: { type: 'string' },
        source: { type: 'string', default: sources[0]?.id ?? '' },
        'top-k': { type: 'string' },
        strategy: { type: 'string' },
        strategies: { type: 'string' },
        'without-tag': { type: 'string' },
        record: { type: 'boolean', default: false },
        after: { type: 'string' },
        'sample-of': { type: 'string' },
        rows: { type: 'string' },
        only: { type: 'string' },
        noise: { type: 'boolean', default: false },
        spot: { type: 'boolean', default: false },
        draft: { type: 'boolean', default: false },
        top: { type: 'string' },
        'max-usd': { type: 'string' },
        yes: { type: 'boolean', default: false },
        'doc-type': { type: 'string', multiple: true },
        json: { type: 'boolean', default: false },
        verbose: { type: 'boolean', short: 'v', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    })
  } catch (error) {
    err.write(`drl: ${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`)
    return 2
  }
  const { values, positionals } = parsed
  const [command, ...rest] = positionals
  if (values.help || command === undefined || command === 'help') {
    out.write(USAGE)
    return command === undefined && !values.help ? 2 : 0
  }
  if (!['sync', 'ask', 'search', 'limits', 'eval', 'questions'].includes(command)) {
    err.write(`drl: unknown command "${command}"\n\n${USAGE}`)
    return 2
  }
  if (values.json && command !== 'search') {
    err.write(`drl: --json works only with search\n\n${USAGE}`)
    return 2
  }
  if (values.at !== undefined && command !== 'sync') {
    err.write(`drl: --at works only with sync\n\n${USAGE}`)
    return 2
  }
  const variants = (['contextual', 'control', 'compiled'] as const).filter((name) => values[name])
  const variant = variants[0]
  if (variants.length > 1) {
    err.write(`drl: --${variants.join(' and --')} are different indexes\n\n${USAGE}`)
    return 2
  }
  if (variant !== undefined && command !== 'sync' && command !== 'eval') {
    err.write(`drl: --${variant} works only with sync and eval check\n\n${USAGE}`)
    return 2
  }
  if (
    values.pilot !== undefined &&
    !(command === 'sync' && values.contextual) &&
    command !== 'questions'
  ) {
    err.write(`drl: --pilot works only with sync --contextual and questions\n\n${USAGE}`)
    return 2
  }
  if (command === 'sync' && variant !== undefined && (values.full || values.at !== undefined)) {
    err.write(
      `drl: sync --${variant} always reads every chunk, at the plain index's commit, so it takes no --full or --at\n\n${USAGE}`,
    )
    return 2
  }
  if (command === 'sync' && values.yes && variant === undefined) {
    err.write(
      `drl: --yes works with sync only together with --contextual, --control or --compiled\n\n${USAGE}`,
    )
    return 2
  }
  if (values.accept && command !== 'eval') {
    err.write(`drl: --accept works only with eval check\n\n${USAGE}`)
    return 2
  }
  if (values.name !== undefined && command !== 'eval') {
    err.write(`drl: --name works only with eval\n\n${USAGE}`)
    return 2
  }
  if (values['set-version'] !== undefined && !values.accept) {
    err.write(`drl: --set-version works only with eval check --accept\n\n${USAGE}`)
    return 2
  }

  const meter = new UsageMeter()
  const start = now()
  try {
    const root = options.root ?? findRepoRoot(import.meta.dirname)
    loadRootEnv(root)
    const guard = await startRunGuard(root)
    // Every Voyage call of every command goes through these two.
    const createProvider = () =>
      guardEmbeddings(
        options.createProvider?.() ?? createEmbeddingProvider(settings.embeddings),
        guard,
      )
    const createReranker = () =>
      guardReranker(options.createReranker?.() ?? createRerankProvider(settings.rerank), guard)
    const engineFor = (index?: IndexVariant) =>
      createEngine({
        settings,
        sources,
        root,
        variant: index,
        createReranker,
        createProvider,
      })
    const ctx = {
      settings,
      sources,
      engine: engineFor(),
      engineFor,
      root,
      meter,
      out,
      now,
      guard,
      createEvalClient: options.createEvalClient,
      createReranker,
      createProvider,
    }
    if (command === 'sync') {
      const source = rest[0]
      if (source === undefined)
        throw new CliError('sync needs a source id, for example: drl sync typescript')
      if (values.compiled) {
        await syncCompiledCommand(ctx, { source, yes: values.yes })
      } else if (values.control) {
        await syncControlCommand(ctx, { source, yes: values.yes })
      } else if (values.contextual) {
        await syncContextualCommand(ctx, {
          source,
          yes: values.yes,
          pilot:
            values.pilot === undefined
              ? undefined
              : positiveInteger(values.pilot, 10, '--pilot', MAX_PILOT),
        })
      } else {
        await syncCommand(ctx, { source, full: values.full, at: commitOf(values.at) })
      }
    } else if (command === 'ask' || command === 'search') {
      const question = rest.join(' ').trim()
      if (question === '') {
        throw new CliError(
          `${command} needs a question, for example: drl ${command} "What is a union type?"`,
        )
      }
      const retrieval: RetrievalArgs = {
        question,
        source: values.source,
        topK: positiveInteger(values['top-k'], settings.retrieval.topK, '--top-k', MAX_TOP_K),
        strategy: strategyOf(values.strategy, settings.retrieval.strategy),
        docTypes: docTypesOf(values['doc-type']),
      }
      if (command === 'ask') await askCommand(ctx, { ...retrieval, verbose: values.verbose })
      else await searchCommand(ctx, { ...retrieval, json: values.json })
    } else if (command === 'eval') {
      const [subcommand, first, second] = rest
      refuseStrayEvalFlags(subcommand, values)
      if (subcommand === undefined) {
        await evalRunCommand(ctx, {
          source: values.source,
          name: values.name,
          strategy:
            values.strategy === undefined
              ? undefined
              : strategyOf(values.strategy, settings.retrieval.strategy),
          yes: values.yes,
          variant,
        })
      } else if (subcommand === 'answers') {
        const maxUsd = values['max-usd'] === undefined ? undefined : Number(values['max-usd'])
        if (maxUsd !== undefined && !(maxUsd > 0)) {
          throw new CliError('--max-usd must be a number above 0')
        }
        await evalAnswersCommand(ctx, {
          source: values.source,
          name: values.name,
          rows: parseRows(values.rows),
          only: values.only?.split(',').map((id) => id.trim()),
          noise: values.noise,
          maxUsd,
          yes: values.yes,
        })
      } else if (subcommand === 'judge-check') {
        await evalJudgeCheckCommand(ctx, { source: values.source, yes: values.yes })
      } else if (subcommand === 'rerank-check') {
        await evalRerankCheckCommand(ctx, { source: values.source, yes: values.yes })
      } else if (subcommand === 'label') {
        if (first === undefined) throw new CliError('eval label needs a report file')
        evalLabelCommand(ctx, {
          path: first,
          after: values.after,
          rows: values.rows === undefined ? undefined : parseRows(values.rows),
          spot: values.spot,
        })
      } else if (subcommand === 'spot-check') {
        if (first === undefined || second === undefined) {
          throw new CliError('eval spot-check needs a report file and a labels file')
        }
        evalSpotCheckCommand(ctx, { path: first, labels: second, after: values.after })
      } else if (subcommand === 'calibrate') {
        if (first === undefined || second === undefined) {
          throw new CliError('eval calibrate needs a report file and a labels file')
        }
        evalCalibrateCommand(ctx, {
          path: first,
          labels: second,
          after: values.after,
          sampleOf: values['sample-of'],
          rows: values.rows === undefined ? undefined : parseRows(values.rows),
        })
      } else if (subcommand === 'verify') {
        if (first === undefined) throw new CliError('eval verify needs a report file')
        await evalVerifyCommand(ctx, { path: first, record: values.record })
      } else if (subcommand === 'compare') {
        if (first === undefined || second === undefined) {
          throw new CliError('eval compare needs two report files')
        }
        evalCompareCommand(ctx, {
          a: first,
          b: second,
          strategies: strategyPairOf(values.strategies),
          withoutTag: values['without-tag'],
        })
      } else if (subcommand === 'check') {
        if (rest.length > 1) throw new CliError('eval check takes no arguments: use --source <id>')
        if (values.draft) {
          if (values.accept || variant !== undefined) {
            throw new CliError(
              'a draft is checked against the plain index and is never accepted as it is',
            )
          }
          evalDraftCheckCommand(ctx, { source: values.source })
        } else {
          const setVersion = values['set-version']
          evalCheckCommand(ctx, {
            source: values.source,
            accept: values.accept,
            variant,
            setVersion:
              setVersion === undefined
                ? undefined
                : positiveInteger(setVersion, 1, '--set-version', MAX_SET_VERSION),
          })
        }
      } else if (subcommand === 'walk') {
        if (rest.length > 1) throw new CliError('eval walk takes no arguments: use --source <id>')
        await evalWalkCommand(ctx, {
          source: values.source,
          top: positiveInteger(values.top, WALK_TOP, '--top', MAX_WALK),
        })
      } else {
        throw new CliError(
          `unknown eval command "${subcommand}" (known: answers, calibrate, check, compare, judge-check, label, spot-check, rerank-check, verify, walk)`,
        )
      }
    } else if (command === 'questions') {
      const [first, second] = rest
      if (first === undefined) {
        throw new CliError(
          'questions needs a source id, sample, score, flagged, unflag or reject, for example: drl questions typescript',
        )
      }
      if (first === 'sample') {
        questionsSampleCommand(ctx)
      } else if (first === 'score') {
        if (second === undefined) throw new CliError('questions score needs a labels file')
        questionsScoreCommand(ctx, { labels: second })
      } else if (first === 'flagged') {
        questionsFlaggedCommand(ctx)
      } else if (first === 'unflag') {
        if (second === undefined) throw new CliError('questions unflag needs a question id')
        questionsUnflagCommand(ctx, { questionId: second })
      } else if (first === 'reject') {
        if (second === undefined) throw new CliError('questions reject needs a question id')
        const reason = rest.slice(2).join(' ').trim()
        questionsRejectCommand(ctx, {
          questionId: second,
          reason: reason === '' ? undefined : reason,
        })
      } else {
        await questionsCommand(ctx, {
          source: first,
          yes: values.yes,
          pilot:
            values.pilot === undefined
              ? undefined
              : positiveInteger(values.pilot, 10, '--pilot', MAX_PILOT),
        })
      }
    } else {
      await limitsCommand(ctx)
    }
    return 0
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    err.write(`\ndrl ${command} failed: ${message}\n`)
    if (options.debug ?? process.env.DRL_DEBUG === '1') {
      if (error instanceof Error && error.stack !== undefined) err.write(`${error.stack}\n`)
    } else if (!isUsageError(error)) {
      err.write('Set DRL_DEBUG=1 to see the stack trace.\n')
    }
    return 1
  } finally {
    // With --json, stdout carries only the JSON; the usage lines go to stderr.
    const report = values.json ? err : out
    report.write(`\n${formatUsage(meter, settings.pricing)}\n`)
    report.write(`elapsed: ${formatDuration(now() - start)}\n`)
  }
}
