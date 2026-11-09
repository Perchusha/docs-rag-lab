// The interview-prep app's one backend (ADR-0018): the bank, read on the first request and kept
// for the life of the server process, and the progress store, opened once. An app builds its
// sources, which this package does not import, and passes them in. Only the mock interview's
// grading needs keys, so its search and Claude client are built on its first graded answer, and
// the root dotenv file is loaded then, as docs-server does: Next.js reads only the app folder's.
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

import {
  createClaudeClient,
  createEngine,
  findRepoRoot,
  interviewStatePath,
  loadInterviewBank,
  loadRootEnv,
  openInterviewState,
  type Interviewer,
  type LoadedBank,
  type Source,
} from '@docs-rag-lab/core'
import { settings } from '@docs-rag-lab/settings'

import type { InterviewBackend } from './handlers.ts'

export interface BackendOptions {
  /** The sources the app offers, in order. Built on first use. */
  sources: () => readonly Source[]
  /** Defaults to the repository root above the working directory. */
  root?: string | undefined
  /** For tests. Defaults to the clock. */
  now?: (() => Date) | undefined
  /** For tests. Defaults to hybrid search on each source's plain index, and Claude. */
  interviewer?: (() => Interviewer) | undefined
}

/** Where the app keeps its progress and flags (SPEC section 4). */
export const statePath = (root: string): string => interviewStatePath(root, settings.dataDir)

/** Hybrid search on the plain indexes of the app's sources, and the Claude client (ADR-0018). */
function buildInterviewer(root: string, sources: readonly Source[]): Interviewer {
  loadRootEnv(root)
  const engine = createEngine({ settings, sources, root })
  return { search: (request, meter) => engine.search(request, meter), client: createClaudeClient() }
}

/** The app's backend, built by the first call that succeeds and the same one after that. */
export function onceInterview(options: BackendOptions): () => InterviewBackend {
  let backend: InterviewBackend | undefined
  return () => {
    if (backend !== undefined) return backend
    const root = options.root ?? findRepoRoot(process.cwd())
    const sources = options.sources()
    let bank: LoadedBank | undefined
    let state: ReturnType<typeof openInterviewState> | undefined
    let interviewer: Interviewer | undefined
    const built: InterviewBackend = {
      sources: sources.map(({ id }) => id),
      bank: () =>
        (bank ??= loadInterviewBank({ root, dataDir: join(root, settings.dataDir), sources })),
      state: () => (state ??= openInterviewState(statePath(root))),
      interviewer: () =>
        (interviewer ??= options.interviewer?.() ?? buildInterviewer(root, sources)),
      now: options.now ?? (() => new Date()),
      newId: () => randomUUID(),
    }
    backend = built
    return built
  }
}
