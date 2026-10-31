// Stop hook: before Claude finishes, run the tests of packages changed since
// HEAD and of their dependents. `test` depends on the boundary check, so edits
// made through the shell, which skip PostToolUse, are checked here too. A
// failure blocks the stop once (exit code 2); see lib/stop.ts for why it
// cannot loop.
import {
  exitWithHookProblem,
  formatSeconds,
  isOnPath,
  projectDirOf,
  readHookInput,
  runCommand,
  truncate,
} from './lib/hook-io.ts'
import { stopOutcome } from './lib/stop.ts'

try {
  const input = await readHookInput()
  const projectDir = projectDirOf(input)
  if (!isOnPath('pnpm')) exitWithHookProblem('stop-tests', 'pnpm is not on PATH')

  // Before the first commit there is no HEAD to compare with: run everything.
  const hasHead = runCommand('git rev-parse --verify --quiet HEAD', projectDir).ok
  const filter = hasHead ? ' "--filter=...[HEAD]"' : ''
  const result = runCommand(
    `pnpm turbo run test${filter} --output-logs=errors-only --no-color`,
    projectDir,
    540_000,
  )
  if (result.problem !== undefined) exitWithHookProblem('stop-tests', result.problem)

  const scope = hasHead ? 'packages changed since HEAD' : 'all packages'
  const summary = `stop-tests: tests for ${scope} ${result.ok ? 'passed' : 'failed'} in ${formatSeconds(result.ms)}`

  switch (stopOutcome(result.ok, input.stop_hook_active === true)) {
    case 'pass':
      process.exit(0)
      break
    case 'warn':
      process.stdout.write(
        JSON.stringify({ systemMessage: `${summary}, still failing after a retry` }),
      )
      process.exit(0)
      break
    case 'block':
      process.stderr.write(`${summary}\n\n${truncate(result.output)}\n`)
      process.exit(2)
  }
} catch (error) {
  // A broken Stop hook must not trap Claude: report it and let the stop happen.
  exitWithHookProblem('stop-tests', error instanceof Error ? error.message : String(error))
}
