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
  UnknownSourceError,
  UsageMeter,
  type DocType,
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
  evalCompareCommand,
  evalRunCommand,
  evalVerifyCommand,
  type RetrievalChoice,
} from './eval-commands.ts'
import { formatDuration } from './format.ts'

export const USAGE = `Usage: drl <command> [options]

Commands:
  sync <source> [--full]      Sync, parse, chunk and embed a source (incremental by default)
      [--at <sha>]            Index this commit (a full SHA) instead of the head of the branch;
                              the next sync without it returns to the head
  ask "<question>"            Answer from the docs with cited sources
      [--verbose]             Print the retrieval trace before the answer
  search "<question>"         Retrieval only, no answer: print the retrieval trace
      [--json]                Print the whole trace as JSON (the usage line goes to stderr)
  limits                      Show the embedding API's rate-limit headers (one tiny request)
  eval                        Retrieval metrics over the golden set, written as a report.
                              No Claude call. Without --name it is a development run
      [--name <name>]         A run to keep, such as baseline: needs a clean tree and check
      [--strategy <s>]        One strategy instead of vector and hybrid
      [--exact-tokens <m>]    all or code-shaped (default: retrieval.exactTokens, ADR-0011)
      [--short-terms <m>]     substring or whole-word (default: retrieval.shortTerms, ADR-0011)
  eval verify <report>        Run a report again, and say whether it reproduces
  eval compare <a> <b>        Compare two reports question by question, and mark what is noise
  eval check [--source <id>]  Check the golden set against the index (no API calls): which
                              questions are stale, and which anchors changed since the lock
      [--accept]              After reviewing them, record what the anchors resolve to now
      [--set-version <n>]     With --accept: the new version of a set that changed (ADR-0009)

Retrieval options (ask and search):
  --source <id>               The source to search (default: the first in settings)
  --strategy vector|hybrid    Vector search only, or vector + keyword search fused by RRF
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

function oneOf<T extends string>(
  flag: string,
  value: string | undefined,
  allowed: readonly [T, T],
): T | undefined {
  if (value === undefined) return undefined
  const found = allowed.find((item) => item === value)
  if (found === undefined) {
    throw new CliError(`${flag} must be ${allowed.join(' or ')}, got "${value}"`)
  }
  return found
}

function choiceOf(values: { 'exact-tokens'?: string; 'short-terms'?: string }): RetrievalChoice {
  const exactTokens = oneOf('--exact-tokens', values['exact-tokens'], ['all', 'code-shaped'])
  const shortTerms = oneOf('--short-terms', values['short-terms'], ['substring', 'whole-word'])
  return {
    ...(exactTokens === undefined ? {} : { exactTokens }),
    ...(shortTerms === undefined ? {} : { shortTerms }),
  }
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
    'exact-tokens'?: string | undefined
    'short-terms'?: string | undefined
    'top-k'?: string | undefined
    'doc-type'?: string[] | undefined
  },
): void {
  const stray = [
    ...(values['top-k'] === undefined ? [] : ['--top-k']),
    ...(values['doc-type'] === undefined ? [] : ['--doc-type']),
    ...(values.accept && subcommand !== 'check' ? ['--accept'] : []),
    ...(values.name !== undefined && subcommand !== undefined ? ['--name'] : []),
    ...(values.strategy !== undefined && subcommand !== undefined ? ['--strategy'] : []),
    ...(values['exact-tokens'] !== undefined && subcommand !== undefined ? ['--exact-tokens'] : []),
    ...(values['short-terms'] !== undefined && subcommand !== undefined ? ['--short-terms'] : []),
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
    error instanceof GoldenSetError
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
        accept: { type: 'boolean', default: false },
        'set-version': { type: 'string' },
        name: { type: 'string' },
        source: { type: 'string', default: sources[0]?.id ?? '' },
        'top-k': { type: 'string' },
        strategy: { type: 'string' },
        'exact-tokens': { type: 'string' },
        'short-terms': { type: 'string' },
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
  if (values.accept && command !== 'eval') {
    err.write(`drl: --accept works only with eval check\n\n${USAGE}`)
    return 2
  }
  if (values.name !== undefined && command !== 'eval') {
    err.write(`drl: --name works only with eval\n\n${USAGE}`)
    return 2
  }
  if (
    (values['exact-tokens'] !== undefined || values['short-terms'] !== undefined) &&
    command !== 'eval'
  ) {
    err.write(`drl: --exact-tokens and --short-terms work only with eval\n\n${USAGE}`)
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
    const engine = createEngine({ settings, sources, root })
    const ctx = { settings, sources, engine, root, meter, out, now }
    if (command === 'sync') {
      const source = rest[0]
      if (source === undefined)
        throw new CliError('sync needs a source id, for example: drl sync typescript')
      await syncCommand(ctx, { source, full: values.full, at: commitOf(values.at) })
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
          choice: choiceOf(values),
        })
      } else if (subcommand === 'verify') {
        if (first === undefined) throw new CliError('eval verify needs a report file')
        await evalVerifyCommand(ctx, { path: first })
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
          setVersion:
            setVersion === undefined
              ? undefined
              : positiveInteger(setVersion, 1, '--set-version', MAX_SET_VERSION),
        })
      } else {
        throw new CliError(`unknown eval command "${subcommand}" (known: check, verify, compare)`)
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
