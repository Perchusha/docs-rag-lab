import { parseArgs } from 'node:util'

import { STRATEGIES, type Strategy } from '@docs-rag-lab/contracts'
import {
  createEngine,
  DOC_TYPES,
  findRepoRoot,
  formatUsage,
  loadRootEnv,
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
  limitsCommand,
  searchCommand,
  syncCommand,
  type RetrievalArgs,
  type Writer,
} from './commands.ts'
import { CliError } from './errors.ts'
import { formatDuration } from './format.ts'

export const USAGE = `Usage: drl <command> [options]

Commands:
  sync <source> [--full]      Sync, parse, chunk and embed a source (incremental by default)
  ask "<question>"            Answer from the docs with cited sources
      [--verbose]             Print the retrieval trace before the answer
  search "<question>"         Retrieval only, no answer: print the retrieval trace
      [--json]                Print the whole trace as JSON (the usage line goes to stderr)
  limits                      Show the embedding API's rate-limit headers (one tiny request)

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

// More chunks than this would not make a useful answer request; sqlite-vec also caps k at 4096.
const MAX_TOP_K = 100

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

/** Errors whose message says what to do; they need no stack trace. */
function isUsageError(error: unknown): boolean {
  return (
    error instanceof CliError ||
    error instanceof MissingKeyError ||
    error instanceof UnknownSourceError
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
        source: { type: 'string', default: sources[0]?.id ?? '' },
        'top-k': { type: 'string' },
        strategy: { type: 'string' },
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
  if (!['sync', 'ask', 'search', 'limits'].includes(command)) {
    err.write(`drl: unknown command "${command}"\n\n${USAGE}`)
    return 2
  }
  if (values.json && command !== 'search') {
    err.write(`drl: --json works only with search\n\n${USAGE}`)
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
      await syncCommand(ctx, { source, full: values.full })
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
