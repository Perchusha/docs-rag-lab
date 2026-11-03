// Which code a report came from (ADR-0010). Ignored files such as data/ do not make
// a tree dirty; untracked source files do, since they can change the result.
import { git } from '@docs-rag-lab/source-kit'

export interface RepoState {
  sha: string
  dirty: boolean
}

export async function readRepoState(root: string): Promise<RepoState> {
  const sha = (await git(['rev-parse', 'HEAD'], { cwd: root })).trim()
  const status = await git(['status', '--porcelain'], { cwd: root })
  return { sha, dirty: status.trim() !== '' }
}
