// The interview-prep app's one backend (ADR-0018): the bank, read on the first request and kept
// for the life of the server process, and the progress store, opened once. An app builds its
// sources, which this package does not import, and passes them in. Nothing here needs a key.
import { join } from 'node:path'

import {
  findRepoRoot,
  loadInterviewBank,
  openInterviewState,
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
}

/** Where the app keeps its progress (SPEC section 4). */
export const statePath = (root: string): string =>
  join(root, settings.dataDir, 'apps', 'interview-prep.sqlite')

/** The app's backend, built by the first call that succeeds and the same one after that. */
export function onceInterview(options: BackendOptions): () => InterviewBackend {
  let backend: InterviewBackend | undefined
  return () => {
    if (backend !== undefined) return backend
    const root = options.root ?? findRepoRoot(process.cwd())
    const sources = options.sources()
    let bank: LoadedBank | undefined
    let state: ReturnType<typeof openInterviewState> | undefined
    backend = {
      sources: sources.map(({ id }) => id),
      bank: () =>
        (bank ??= loadInterviewBank({ root, dataDir: join(root, settings.dataDir), sources })),
      state: () => (state ??= openInterviewState(statePath(root))),
      now: options.now ?? (() => new Date()),
    }
    return backend
  }
}
