// An app's one engine (ADR-0008). Built on the first request and kept for the
// life of the server process, so the embedding rate limiter sees every request
// and Voyage's limits hold across them. The root dotenv file is loaded here:
// Next.js only reads the app folder's own.
import {
  createEngine,
  findRepoRoot,
  loadRootEnv,
  type Engine,
  type Source,
} from '@docs-rag-lab/core'
import { settings } from '@docs-rag-lab/settings'

/** The sources an app can build, from their options in settings. This package imports none. */
export type SourceBuilders = Readonly<Record<string, () => Source>>

/** The Source that the app's rag.config.ts names. */
export function appSource(id: string, sources: SourceBuilders): Source {
  const build = sources[id]
  if (build === undefined) {
    throw new Error(
      `rag.config.ts names the source "${id}", which this app cannot build (known: ${Object.keys(sources).join(', ')})`,
    )
  }
  return build()
}

function buildEngine(source: Source): Engine {
  const root = findRepoRoot(process.cwd())
  loadRootEnv(root)
  return createEngine({ settings, sources: [source], root })
}

/** The app's engine, built by the first call that succeeds and the same one after that. */
export function onceEngine(
  source: () => Source,
  build: (source: Source) => Engine = buildEngine,
): () => Engine {
  let engine: Engine | undefined
  return () => (engine ??= build(source()))
}
