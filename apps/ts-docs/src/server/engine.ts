// The app's one engine (ADR-0008). Built on the first request and kept for the
// life of the server process, so the embedding rate limiter sees every request
// and Voyage's limits hold across them. The root dotenv file is loaded here:
// Next.js only reads the app folder's own.
import { createEngine, findRepoRoot, loadRootEnv, type Engine } from '@docs-rag-lab/core'
import { settings } from '@docs-rag-lab/settings'
import { typescriptSource } from '@docs-rag-lab/source-typescript'

let engine: Engine | undefined

export function appEngine(): Engine {
  if (engine === undefined) {
    const root = findRepoRoot(process.cwd())
    loadRootEnv(root)
    engine = createEngine({
      settings,
      sources: [typescriptSource(settings.sources.typescript)],
      root,
    })
  }
  return engine
}
