// PreToolUse hook: keeps Claude away from secrets (.env*) and from generated
// data (data/, .cache/). Exit code 2 blocks the tool call and shows the reason.
import { checkToolUse } from './lib/guard.ts'
import { projectDirOf, readHookInput } from './lib/hook-io.ts'

try {
  const input = await readHookInput()
  const decision = checkToolUse(input, projectDirOf(input))
  if (!decision.allowed) {
    process.stderr.write(`${decision.reason}\n`)
    process.exit(2)
  }
} catch (error) {
  // Fail closed: a broken guard must not let a tool call through unchecked.
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`guard-paths: failed (${message}), blocking to be safe.\n`)
  process.exit(2)
}
