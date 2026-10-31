// PostToolUse hook: after Claude edits a file, run lint, typecheck and the
// dependency-cruiser boundary check (a dependency of lint) for the touched
// package. Exit code 2 sends the errors back to Claude. Every run reports its
// duration, so the cost of the hook stays visible (ADR-0002).
import {
  exitWithHookProblem,
  formatSeconds,
  isOnPath,
  projectDirOf,
  readHookInput,
  runCommand,
  stringField,
  truncate,
} from './lib/hook-io.ts'
import { findWorkspacePackage, isCheckedFile } from './lib/workspace.ts'

let filePath: string | undefined
try {
  const input = await readHookInput()
  const projectDir = projectDirOf(input)
  filePath = stringField(input.tool_input, 'file_path')
  if (filePath === undefined || !isCheckedFile(filePath)) process.exit(0)

  const pkg = findWorkspacePackage(filePath, projectDir)
  if (pkg === null) process.exit(0)
  if (!isOnPath('pnpm')) exitWithHookProblem('post-edit', 'pnpm is not on PATH')

  const result = runCommand(
    `pnpm turbo run lint typecheck --filter=${pkg.name} --output-logs=errors-only --no-color`,
    projectDir,
  )
  if (result.problem !== undefined) exitWithHookProblem('post-edit', result.problem)

  const summary = `post-edit: lint, typecheck and depcruise for ${pkg.name} ${
    result.ok ? 'passed' : 'failed'
  } in ${formatSeconds(result.ms)}`
  if (!result.ok) {
    process.stderr.write(`${summary}\n\n${truncate(result.output)}\n`)
    process.exit(2)
  }
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: summary },
    }),
  )
} catch (error) {
  // Most likely the edit itself broke something the hook reads, such as a
  // package.json. Exit code 2 tells Claude, who just made the edit.
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`post-edit: could not check ${filePath ?? 'the edited file'}: ${message}\n`)
  process.exit(2)
}
