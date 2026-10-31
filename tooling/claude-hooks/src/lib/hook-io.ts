import { spawnSync } from 'node:child_process'

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
}

/**
 * Runs a command line through the shell. A shell is needed on Windows, where
 * pnpm is a .cmd shim; callers only pass fixed strings and package names.
 */
export function runCommand(commandLine: string, cwd: string): CommandResult {
  const started = performance.now()
  const result = spawnSync(commandLine, {
    cwd,
    shell: true,
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
  })
  return {
    ok: result.status === 0,
    output: `${result.stdout}${result.stderr}`.trim(),
    ms: performance.now() - started,
  }
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
