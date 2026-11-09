// What this app gives the shared server code (ADR-0018): the sources it offers, which
// interview-server does not import, and from them its one backend for the life of the process.
import { onceInterview } from '@docs-rag-lab/interview-server'
import { settings } from '@docs-rag-lab/settings'
import { reactSource } from '@docs-rag-lab/source-react'
import { typescriptSource } from '@docs-rag-lab/source-typescript'

import config from '../interview.config.ts'

const builders = {
  typescript: () => typescriptSource(settings.sources.typescript),
  react: () => reactSource(settings.sources.react),
} as const

/** The sources interview.config.ts names, in its order. */
export const sources = () =>
  config.sources.map(({ id }) => {
    const build = builders[id]
    return build()
  })

export const appBackend = onceInterview({ sources })
