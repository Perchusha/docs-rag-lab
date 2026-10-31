import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export class GitError extends Error {
  readonly stderr: string

  constructor(message: string, stderr: string) {
    super(message)
    this.name = 'GitError'
    this.stderr = stderr
  }
}

/**
 * Runs git without a shell, so paths with spaces need no quoting. Returns
 * stdout. Throws GitError with git's stderr on a non-zero exit.
 */
export async function git(
  args: readonly string[],
  options: { cwd?: string } = {},
): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd: options.cwd,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    })
    return stdout
  } catch (error) {
    const stderr =
      typeof error === 'object' && error !== null && 'stderr' in error ? String(error.stderr) : ''
    throw new GitError(`git ${args.join(' ')} failed: ${stderr.trim() || String(error)}`, stderr)
  }
}
