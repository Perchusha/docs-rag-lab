// A long run stays where it started (ADR-0010). A report says which commit it came from, and a run
// can take an hour, while the working tree can move under it. So a command notes HEAD and the
// branch when it starts, and checks them before each paid call and before it writes a report. If
// either changed it stops: what was paid for is cached, so a rerun in the right place pays only
// for the rest.
import { git } from '@docs-rag-lab/source-kit'

import type { EmbeddingProvider } from './embeddings/provider.ts'
import type { RerankProvider } from './rerank/provider.ts'

export class RunMovedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RunMovedError'
  }
}

export interface RunGuard {
  /** Throws RunMovedError when HEAD or the branch is no longer what it was at the start. */
  check(): Promise<void>
}

interface RunPosition {
  sha: string
  /** The branch, or HEAD when none is checked out. */
  branch: string
}

async function positionOf(root: string): Promise<RunPosition> {
  const output = await git(['rev-parse', 'HEAD', '--abbrev-ref', 'HEAD'], { cwd: root })
  const [sha = '', branch = ''] = output.trim().split(/\r?\n/)
  return { sha, branch }
}

const placeOf = ({ sha, branch }: RunPosition): string =>
  `${sha.slice(0, 8)} on ${branch === 'HEAD' ? 'no branch' : branch}`

/** Notes where the repository is. Outside a repository there is nothing to hold, so no guard. */
export async function startRunGuard(root: string): Promise<RunGuard | undefined> {
  let start: RunPosition
  try {
    start = await positionOf(root)
  } catch {
    return undefined
  }
  return {
    check: async () => {
      let now: RunPosition
      try {
        now = await positionOf(root)
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        throw new RunMovedError(
          `could not tell whether the repository is still at ${placeOf(start)}, so this run stopped: ${reason}`,
        )
      }
      if (now.sha === start.sha && now.branch === start.branch) return
      throw new RunMovedError(
        `the repository moved during this run: it started at ${placeOf(start)}, and is now at ${placeOf(now)}. Nothing more was paid for and no report was written, and what was paid for is cached: go back and run this again`,
      )
    },
  }
}

/** The same provider, checking the guard right before each request, after any wait for a slot. */
export function guardEmbeddings(
  provider: EmbeddingProvider,
  guard: RunGuard | undefined,
): EmbeddingProvider {
  if (guard === undefined) return provider
  return {
    ...provider,
    embed: async (texts, inputType) => {
      await guard.check()
      return provider.embed(texts, inputType)
    },
  }
}

/** The same provider, checking the guard right before each request, after any wait for a slot. */
export function guardReranker(
  provider: RerankProvider,
  guard: RunGuard | undefined,
): RerankProvider {
  if (guard === undefined) return provider
  return {
    ...provider,
    rerank: async (query, documents) => {
      await guard.check()
      return provider.rerank(query, documents)
    },
  }
}
