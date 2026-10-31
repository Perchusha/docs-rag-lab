// API keys come from the dotenv file at the repository root, which the CLI
// loads itself, so no command line ever has to name it (CLAUDE.md). Values
// already set in the environment win over the file.
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

export class CliError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CliError'
  }
}

const DOTENV_FILE = '.env'

/** The nearest directory at or above `start` that holds pnpm-workspace.yaml. */
export function findRepoRoot(start: string): string {
  for (let dir = start; ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir
    if (dirname(dir) === dir) throw new CliError(`no pnpm-workspace.yaml above ${start}`)
  }
}

/** Loads the root dotenv file if there is one. Returns whether a file was loaded. */
export function loadEnv(root: string): boolean {
  try {
    process.loadEnvFile(join(root, DOTENV_FILE))
    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
    throw error
  }
}

export type KeyName = 'VOYAGE_API_KEY' | 'ANTHROPIC_API_KEY'

/** The key's value. The error never includes a value, only the name. */
export function requireKey(name: KeyName, env: NodeJS.ProcessEnv = process.env): string {
  const value = env[name]?.trim()
  if (value === undefined || value === '') {
    throw new CliError(
      `${name} is not set. Copy .env.example to .env at the repository root and fill it in, or set it in the environment.`,
    )
  }
  return value
}
