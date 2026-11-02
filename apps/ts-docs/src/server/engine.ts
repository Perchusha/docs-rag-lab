// The app's one engine (ADR-0008). Built on the first request and kept for the
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
import { typescriptSource } from '@docs-rag-lab/source-typescript'

import config from '../../rag.config.ts'

/** The sources this app can build, from their options in settings. */
const SOURCES: Record<string, () => Source> = {
  typescript: () => typescriptSource(settings.sources.typescript),
}

/** The Source that rag.config.ts names. */
export function appSource(id: string): Source {
  const build = SOURCES[id]
  if (build === undefined) {
    throw new Error(
      `rag.config.ts names the source "${id}", which this app cannot build (known: ${Object.keys(SOURCES).join(', ')})`,
    )
  }
  return build()
}

let engine: Engine | undefined

export function appEngine(): Engine {
  if (engine === undefined) {
    const root = findRepoRoot(process.cwd())
    loadRootEnv(root)
    engine = createEngine({ settings, sources: [appSource(config.source)], root })
  }
  return engine
}
