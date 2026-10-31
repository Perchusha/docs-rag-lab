import { parseArgs } from 'node:util'

import { formatUsage, UsageMeter, type DrlConfig } from '@docs-rag-lab/core'

import { askCommand, limitsCommand, syncCommand, type Writer } from './commands.ts'
import defaultConfig from './drl.config.ts'
import { CliError, findRepoRoot, loadEnv } from './env.ts'
import { formatDuration } from './format.ts'

export const USAGE = `Usage: drl <command> [options]

Commands:
  sync <source> [--full]      Sync, parse, chunk and embed a source (incremental by default)
  ask "<question>"            Answer from the docs with cited sources
      [--source <id>] [--top-k <n>] [--verbose]
  limits                      Show the embedding API's rate-limit headers (one tiny request)

Options:
  -h, --help                  Show this help

API keys come from the environment or from .env at the repository root.
Every command that calls an API ends with its token usage and estimated cost.
`

export interface RunOptions {
  config?: DrlConfig
  out?: Writer
  err?: Writer
  root?: string
  now?: () => number
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback
  const n = Number(value)
  if (!Number.isInteger(n) || n <= 0) throw new CliError(`${name} must be a positive integer`)
  return n
}

/** Runs one drl command and returns the process exit code. */
export async function run(argv: readonly string[], options: RunOptions = {}): Promise<number> {
  const out = options.out ?? process.stdout
  const err = options.err ?? process.stderr
  const now = options.now ?? (() => Date.now())
  const config = options.config ?? defaultConfig

  let parsed
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: {
        full: { type: 'boolean', default: false },
        source: { type: 'string', default: config.sources[0]?.id ?? '' },
        'top-k': { type: 'string' },
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
  if (!['sync', 'ask', 'limits'].includes(command)) {
    err.write(`drl: unknown command "${command}"\n\n${USAGE}`)
    return 2
  }

  const root = options.root ?? findRepoRoot(import.meta.dirname)
  loadEnv(root)
  const meter = new UsageMeter()
  const ctx = { config, root, meter, out, now }
  const start = now()
  try {
    if (command === 'sync') {
      const source = rest[0]
      if (source === undefined)
        throw new CliError('sync needs a source id, for example: drl sync typescript')
      await syncCommand(ctx, { source, full: values.full })
    } else if (command === 'ask') {
      const question = rest.join(' ').trim()
      if (question === '')
        throw new CliError('ask needs a question, for example: drl ask "What is a union type?"')
      const topK = positiveInteger(values['top-k'], config.retrieval.topK, '--top-k')
      await askCommand(ctx, { question, source: values.source, topK, verbose: values.verbose })
    } else {
      await limitsCommand(ctx)
    }
    return 0
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    err.write(`\ndrl ${command} failed: ${message}\n`)
    if (!(error instanceof CliError) && error instanceof Error && error.stack !== undefined) {
      err.write(`${error.stack}\n`)
    }
    return 1
  } finally {
    out.write(`\n${formatUsage(meter, config.pricing)}\n`)
    out.write(`elapsed: ${formatDuration(now() - start)}\n`)
  }
}
