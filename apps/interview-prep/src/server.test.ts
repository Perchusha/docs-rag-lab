import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import config from '../interview.config.ts'
import { sources } from './server.ts'

const { scripts } = JSON.parse(
  readFileSync(join(import.meta.dirname, '../package.json'), 'utf8'),
) as { scripts: Record<string, string> }

describe('the server side of this app', () => {
  it('builds the sources interview.config.ts names, in its order, each with a topic map', () => {
    const built = sources()

    expect(built.map(({ id }) => id)).toEqual(config.sources.map(({ id }) => id))
    expect(built.every((source) => source.interviewTopic !== undefined)).toBe(true)
  })

  it.each(['dev', 'start'])('%s binds to 127.0.0.1, on a port of its own', (script) => {
    // The routes have no authentication (ADR-0008).
    expect(scripts[script]).toContain('--hostname 127.0.0.1 --port 3002')
  })
})
