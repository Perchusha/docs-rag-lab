// Git sync for a source (SPEC section 9, ADR-0004): a shallow, sparse,
// blob-less clone into the cache directory, then fetch + diff on later runs.
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { git, GitError } from './git.ts'
import type { Source } from './types.ts'

export interface SyncRepoOptions {
  /** The checkout directory for this source, for example .cache/sources/typescript. */
  checkoutDir: string
  /** The commit of the last successful sync, from the manifest. */
  previousSha?: string | undefined
  /** Skip the diff and report a full build. */
  full?: boolean | undefined
}

export type SyncRepoResult =
  | { headSha: string; mode: 'full'; reason: string }
  | { headSha: string; mode: 'incremental'; changed: string[]; deleted: string[] }

async function commitExists(checkoutDir: string, sha: string): Promise<boolean> {
  try {
    await git(['cat-file', '-e', `${sha}^{commit}`], { cwd: checkoutDir })
    return true
  } catch (error) {
    if (error instanceof GitError) return false
    throw error
  }
}

/** Makes `sha` available locally, fetching it by SHA if needed. */
async function ensureCommit(checkoutDir: string, sha: string): Promise<boolean> {
  if (await commitExists(checkoutDir, sha)) return true
  try {
    await git(['fetch', '--quiet', '--depth', '1', 'origin', sha], { cwd: checkoutDir })
  } catch (error) {
    if (error instanceof GitError) return false
    throw error
  }
  return commitExists(checkoutDir, sha)
}

/** Parses `git diff --name-status -z --no-renames`: status and path, NUL-separated. */
export function parseNameStatus(output: string): { changed: string[]; deleted: string[] } {
  const fields = output.split('\0').filter((field) => field !== '')
  const changed: string[] = []
  const deleted: string[] = []
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const status = fields[i] ?? ''
    const path = fields[i + 1] ?? ''
    if (status.startsWith('D')) deleted.push(path)
    else changed.push(path)
  }
  return { changed, deleted }
}

/** The checkout's origin URL, or undefined when there is no usable checkout. */
async function originOf(checkoutDir: string): Promise<string | undefined> {
  if (!existsSync(join(checkoutDir, '.git'))) return undefined
  try {
    return (await git(['remote', 'get-url', 'origin'], { cwd: checkoutDir })).trim()
  } catch (error) {
    if (error instanceof GitError) return undefined
    throw error
  }
}

async function cloneOrUpdate(source: Source, checkoutDir: string): Promise<void> {
  const origin = await originOf(checkoutDir)
  if (origin !== source.repo) {
    // No checkout yet, or one of another repository: start from a fresh clone.
    rmSync(checkoutDir, { recursive: true, force: true })
    mkdirSync(dirname(checkoutDir), { recursive: true })
    // core.autocrlf=false is stored in the new repo's config: a global
    // autocrlf=true (common on Windows) would otherwise rewrite the checkout.
    await git([
      'clone',
      '--quiet',
      '-c',
      'core.autocrlf=false',
      '--depth',
      '1',
      '--filter=blob:none',
      '--sparse',
      '--single-branch',
      '--branch',
      source.branch,
      source.repo,
      checkoutDir,
    ])
  } else {
    await git(['fetch', '--quiet', '--depth', '1', 'origin', source.branch], { cwd: checkoutDir })
    await git(['checkout', '--quiet', '--force', '--detach', 'FETCH_HEAD'], { cwd: checkoutDir })
  }
  // Re-applied every time, so a changed include list takes effect.
  await git(['sparse-checkout', 'set', '--', ...source.include], { cwd: checkoutDir })
}

/**
 * Brings the checkout to the head of the source branch and reports what
 * changed since `previousSha`: the changed and deleted files under the include
 * paths that `source.match` accepts, or a full build with the reason.
 */
export async function syncRepo(source: Source, options: SyncRepoOptions): Promise<SyncRepoResult> {
  const { checkoutDir, previousSha } = options
  await cloneOrUpdate(source, checkoutDir)
  const headSha = (await git(['rev-parse', 'HEAD'], { cwd: checkoutDir })).trim()

  if (options.full === true) return { headSha, mode: 'full', reason: 'requested' }
  if (previousSha === undefined) return { headSha, mode: 'full', reason: 'no previous sync' }
  if (previousSha === headSha) return { headSha, mode: 'incremental', changed: [], deleted: [] }
  if (!(await ensureCommit(checkoutDir, previousSha))) {
    return { headSha, mode: 'full', reason: `previous commit ${previousSha} is not reachable` }
  }

  const output = await git(
    ['diff', '--name-status', '-z', '--no-renames', previousSha, headSha, '--', ...source.include],
    { cwd: checkoutDir },
  )
  const { changed, deleted } = parseNameStatus(output)
  return {
    headSha,
    mode: 'incremental',
    changed: changed.filter((path) => source.match(path)),
    deleted: deleted.filter((path) => source.match(path)),
  }
}
