// PostToolUse hook: after Claude edits a file, run lint, typecheck and the
// dependency-cruiser boundary check (a dependency of lint) for the touched
// package. Exit code 2 sends the errors back to Claude. Every run reports its
// duration, so the cost of the hook stays visible (ADR-0002).
import {
  formatSeconds,
  projectDirOf,
  readHookInput,
  runCommand,
  stringField,
  truncate,
} from './lib/hook-io.ts'
import { findWorkspacePackage, isCheckedFile } from './lib/workspace.ts'

const input = await readHookInput()
const projectDir = projectDirOf(input)
const filePath = stringField(input.tool_input, 'file_path')
if (filePath === undefined || !isCheckedFile(filePath)) process.exit(0)

const pkg = findWorkspacePackage(filePath, projectDir)
if (pkg === null) process.exit(0)

const result = runCommand(
  `pnpm turbo run lint typecheck --filter=${pkg.name} --output-logs=errors-only --no-color`,
  projectDir,
)
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
