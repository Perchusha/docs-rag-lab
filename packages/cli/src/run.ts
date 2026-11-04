import { parseArgs } from 'node:util'

import { STRATEGIES, type Strategy } from '@docs-rag-lab/contracts'
import {
  createEngine,
  DOC_TYPES,
  findRepoRoot,
  formatUsage,
  GoldenSetError,
  IndexNotFoundError,
  InvalidRequestError,
  loadRootEnv,
  MAX_TOP_K,
  MissingKeyError,
  RerankRejectedError,
  UnknownSourceError,
  UsageMeter,
  type DocType,
  ContextsStoppedError,
  type EmbeddingProvider,
  type EvalClient,
  type RerankProvider,
  type Source,
} from '@docs-rag-lab/core'
import { settings as defaultSettings, type Settings } from '@docs-rag-lab/settings'
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
  evalJudgeCheckCommand,
  evalLabelCommand,
  parseRows,
} from './eval-answers.ts'
import { evalCompareCommand, evalRunCommand, evalVerifyCommand } from './eval-commands.ts'
import { evalRerankCheckCommand } from './eval-rerank.ts'
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
      [--yes]                 Go on with rerank calls that are not cached: without it, a run
                              that needs them prints their estimate and stops
  eval verify <report>        Run a report again, and say whether it reproduces
      [--record]              Write what it found next to the report, for the dashboard
  eval answers                Answer the set under each row and judge the answers. Spends
                              money: prints the estimate, and needs --yes to go on
      [--rows <list>]         Rows of the ladder: 0, 2 and 3 by default
      [--only <ids>]          Only these questions, for a pilot
      [--noise]               Answer row 3 twice and ask the judge twice, to measure noise
      [--max-usd <n>]         Stop before the next paid call past this
      [--name <name>]         A run to keep: the whole set, every row, a clean tree
  eval judge-check            Grade answers whose grade is known. Needs --yes
  eval rerank-check           How a rerank score depends on the rest of its call, compared
                              exactly (ADR-0014). Uses free tokens, and needs --yes to go on
  eval label <report>         Write the sheet a human labels from, with no verdicts
      [--after <report>]      A fresh round: 10 answers, on no question of that report's sheet
  eval calibrate <r> <labels> How often the human and the judge agree
      [--after <report>]      Those labels are of a fresh round after that report
      [--sample-of <report>]  Those labels are of that report's sheet, graded again: not blind
  eval compare <a> <b>        Compare two reports question by question, and mark what is noise
  eval check [--source <id>]  Check the golden set against the index (no API calls): which
                              questions are stale, and which anchors changed since the lock
      [--accept]              After reviewing them, record what the anchors resolve to now
      [--set-version <n>]     With --accept: the new version of a set that changed (ADR-0009)
      [--contextual]          That index, also against the plain one's chunks
      [--control]             That index, also against the plain one's chunks

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

/** The Source objects for the configured sources. Settings hold their options as data. */
export function sourcesFor(settings: Settings): Source[] {
  return [typescriptSource(settings.sources.typescript)]
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
    rows?: string | undefined
    only?: string | undefined
    noise?: boolean | undefined
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
    ...(values.contextual === true && subcommand !== 'check' ? ['--contextual'] : []),
    ...(values.control === true && subcommand !== 'check' ? ['--control'] : []),
    ...(values.after !== undefined && subcommand !== 'label' && subcommand !== 'calibrate'
      ? ['--after']
      : []),
    ...(values['sample-of'] !== undefined && subcommand !== 'calibrate' ? ['--sample-of'] : []),
    ...(values.rows !== undefined && subcommand !== 'answers' ? ['--rows'] : []),
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
    error instanceof ContextsStoppedError
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
        pilot: { type: 'string' },
        accept: { type: 'boolean', default: false },
        'set-version': { type: 'string' },
        name: { type: 'string' },
        source: { type: 'string', default: sources[0]?.id ?? '' },
        'top-k': { type: 'string' },
        strategy: { type: 'string' },
        record: { type: 'boolean', default: false },
        after: { type: 'string' },
        'sample-of': { type: 'string' },
        rows: { type: 'string' },
        only: { type: 'string' },
        noise: { type: 'boolean', default: false },
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
  if (!['sync', 'ask', 'search', 'limits', 'eval'].includes(command)) {
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
  const variant = values.contextual ? 'contextual' : values.control ? 'control' : undefined
  if (values.contextual && values.control) {
    err.write(`drl: --contextual and --control are two different indexes\n\n${USAGE}`)
    return 2
  }
  if (variant !== undefined && command !== 'sync' && command !== 'eval') {
    err.write(`drl: --${variant} works only with sync and eval check\n\n${USAGE}`)
    return 2
  }
  if (values.pilot !== undefined && !(command === 'sync' && values.contextual)) {
    err.write(`drl: --pilot works only with sync --contextual\n\n${USAGE}`)
    return 2
  }
  if (command === 'sync' && variant !== undefined && (values.full || values.at !== undefined)) {
    err.write(
      `drl: sync --${variant} always reads every chunk, at the plain index's commit, so it takes no --full or --at\n\n${USAGE}`,
    )
    return 2
  }
  if (command === 'sync' && values.yes && variant === undefined) {
    err.write(`drl: --yes works with sync only together with --contextual or --control\n\n${USAGE}`)
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
    const engine = createEngine({
      settings,
      sources,
      root,
      createReranker: options.createReranker,
      createProvider: options.createProvider,
    })
    const ctx = {
      settings,
      sources,
      engine,
      root,
      meter,
      out,
      now,
      createEvalClient: options.createEvalClient,
      createReranker: options.createReranker,
      createProvider: options.createProvider,
    }
    if (command === 'sync') {
      const source = rest[0]
      if (source === undefined)
        throw new CliError('sync needs a source id, for example: drl sync typescript')
      if (values.control) {
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
        evalLabelCommand(ctx, { path: first, after: values.after })
      } else if (subcommand === 'calibrate') {
        if (first === undefined || second === undefined) {
          throw new CliError('eval calibrate needs a report file and a labels file')
        }
        evalCalibrateCommand(ctx, {
          path: first,
          labels: second,
          after: values.after,
          sampleOf: values['sample-of'],
        })
      } else if (subcommand === 'verify') {
        if (first === undefined) throw new CliError('eval verify needs a report file')
        await evalVerifyCommand(ctx, { path: first, record: values.record })
      } else if (subcommand === 'compare') {
        if (first === undefined || second === undefined) {
          throw new CliError('eval compare needs two report files')
        }
        evalCompareCommand(ctx, { a: first, b: second })
      } else if (subcommand === 'check') {
        if (rest.length > 1) throw new CliError('eval check takes no arguments: use --source <id>')
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
      } else {
        throw new CliError(
          `unknown eval command "${subcommand}" (known: answers, calibrate, check, compare, judge-check, label, rerank-check, verify)`,
        )
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
