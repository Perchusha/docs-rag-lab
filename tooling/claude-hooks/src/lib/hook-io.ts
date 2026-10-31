import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'

/** The subset of the Claude Code hook input that these hooks read. */
export interface HookInput {
  cwd?: string
  hook_event_name?: string
  tool_name?: string
  tool_input?: Record<string, unknown>
  stop_hook_active?: boolean
}

export function parseHookInput(text: string): HookInput {
  if (text.trim() === '') return {}
  const value: unknown = JSON.parse(text)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('hook input is not a JSON object')
  }
  return value
}

export async function readHookInput(): Promise<HookInput> {
  process.stdin.setEncoding('utf8')
  let text = ''
  for await (const chunk of process.stdin) text += String(chunk)
  return parseHookInput(text)
}

export function stringField(
  record: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = record?.[key]
  return typeof value === 'string' ? value : undefined
}

/** The directory the hooks run against: the project root Claude Code reports. */
export function projectDirOf(input: HookInput): string {
  return process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd()
}

export interface CommandResult {
  ok: boolean
  output: string
  ms: number
  /** Set when the hook itself could not do its job, as opposed to a failing check. */
  problem?: string
}

/**
 * Why a command could not run at all, if it could not. Exit code 127 is
 * "command not found" in sh and 9009 is the same in cmd.exe.
 */
export function commandProblem(
  status: number | null,
  error: Error | undefined,
  commandLine: string,
): string | undefined {
  if (error !== undefined) return `could not run "${commandLine}": ${error.message}`
  if (status === null) return `"${commandLine}" was killed before it finished`
  if (status === 127 || status === 9009) return `"${commandLine}" was not found (is pnpm on PATH?)`
  return undefined
}

/**
 * Runs a command line through the shell. A shell is needed on Windows, where
 * pnpm is a .cmd shim; callers only pass fixed strings and package names.
 * `timeoutMs` stays below the hook timeout in .claude/settings.json, so the
 * hook can still report what happened.
 */
export function runCommand(commandLine: string, cwd: string, timeoutMs = 240_000): CommandResult {
  const started = performance.now()
  const result = spawnSync(commandLine, {
    cwd,
    shell: true,
    encoding: 'utf8',
    timeout: timeoutMs,
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
  })
  const problem = commandProblem(result.status, result.error, commandLine)
  return {
    ok: result.status === 0,
    output: `${result.stdout}${result.stderr}`.trim(),
    ms: performance.now() - started,
    ...(problem === undefined ? {} : { problem }),
  }
}

/**
 * Whether `command` is on PATH. Checked up front because cmd.exe reports an
 * unknown command with exit code 1 and a localized message, which is
 * indistinguishable from a failing check.
 */
export function isOnPath(command: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const extensions =
    process.platform === 'win32' ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';') : ['']
  return (env.PATH ?? env.Path ?? '')
    .split(delimiter)
    .filter((dir) => dir !== '')
    .some((dir) =>
      extensions.some((extension) => existsSync(join(dir, `${command}${extension.toLowerCase()}`))),
    )
}

/** Reports a hook that could not do its job. Exit code 1 is non-blocking. */
export function exitWithHookProblem(hook: string, problem: string): never {
  process.stderr.write(`${hook}: ${problem}. The check did not run.\n`)
  process.exit(1)
}

export function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`
}

/** Keeps the start and the end of long output, where tools print errors and summaries. */
export function truncate(text: string, max = 6000): string {
  if (text.length <= max) return text
  const head = Math.floor(max * 0.6)
  const tail = max - head
  const dropped = text.length - max
  return `${text.slice(0, head)}\n... [${String(dropped)} characters truncated] ...\n${text.slice(-tail)}`
}
