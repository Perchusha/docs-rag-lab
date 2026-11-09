import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { onceInterview, statePath } from './backend.ts'

describe('onceInterview (ADR-0018)', () => {
  it('builds the backend once, and keeps progress under data/apps', () => {
    const root = mkdtempSync(join(tmpdir(), 'interview-backend-'))
    let builds = 0
    const factory = onceInterview({
      root,
      sources: () => {
        builds++
        return []
      },
      now: () => new Date('2026-11-08T12:00:00.000Z'),
    })

    const backend = factory()
    expect(factory()).toBe(backend)
    expect(builds).toBe(1)
    expect(backend.bank()).toEqual({ topics: [], questions: [] })
    expect(backend.state().reviewCount()).toBe(0)
    expect(existsSync(statePath(root))).toBe(true)
    expect(statePath(root).replaceAll('\\', '/')).toMatch(/\/data\/apps\/interview-prep\.sqlite$/)
    backend.state().close()
    rmSync(root, { recursive: true, force: true })
  })
})
