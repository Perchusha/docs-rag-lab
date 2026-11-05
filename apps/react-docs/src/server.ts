// What this app gives the shared server code (ADR-0016): the source it builds, which docs-server
// does not import, and from that its one engine for the life of the process (ADR-0008).
import { appSource, evalStore, onceEngine } from '@docs-rag-lab/docs-server'
import { settings } from '@docs-rag-lab/settings'
import { reactSource } from '@docs-rag-lab/source-react'

import config from '../rag.config.ts'

export const source = () =>
  appSource(config.source, { react: () => reactSource(settings.sources.react) })

export const appEngine = onceEngine(source)

export const appEvalStore = () => evalStore(config.source)
