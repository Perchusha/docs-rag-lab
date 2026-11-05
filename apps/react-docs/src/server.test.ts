import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import config from '../rag.config.ts'
import { appEvalStore, source } from './server.ts'

const { scripts } = JSON.parse(
  readFileSync(join(import.meta.dirname, '../package.json'), 'utf8'),
) as { scripts: Record<string, string> }

describe('the server side of this app', () => {
  it('builds the source rag.config.ts names', () => {
    expect(source().id).toBe(config.source)
  })

  it('reads the eval reports of that source', () => {
    expect(appEvalStore().sourceId).toBe('react')
  })

  it.each(['dev', 'start'])('%s binds to 127.0.0.1, on a port of its own', (script) => {
    // The routes have no authentication and /api/ask spends credits (ADR-0008).
    expect(scripts[script]).toContain('--hostname 127.0.0.1 --port 3001')
  })
})
