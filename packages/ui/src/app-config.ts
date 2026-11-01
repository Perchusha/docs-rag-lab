// What a docs app configures for itself in its rag.config.ts (SPEC section 4,
// apps/CLAUDE.md): only what belongs to the app. Engine settings, such as
// model IDs and prices, come from @docs-rag-lab/settings (ADR-0007).
import type { Theme } from './DocsAssistant.tsx'

export interface DocsAppConfig {
  /** The app's ID, also its folder under apps/. */
  id: string
  /** The source it answers from, a key of settings.sources. */
  source: string
  title: string
  tagline?: string | undefined
  theme: Theme
  examples: readonly string[]
}

/** Checks an app config against DocsAppConfig and returns it as is. */
export function defineDocsApp<const Config extends DocsAppConfig>(config: Config): Config {
  return config
}
