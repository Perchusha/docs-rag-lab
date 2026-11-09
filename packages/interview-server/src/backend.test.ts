import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Interviewer } from '@docs-rag-lab/core'
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

  it('builds the interviewer only when an answer is graded, and once', () => {
    let built = 0
    const interviewer = {
      search: () => Promise.reject(new Error('not searched here')),
      client: { messages: { stream: () => Promise.reject(new Error('not called here')) } },
    } as unknown as Interviewer
    const backend = onceInterview({
      root: mkdtempSync(join(tmpdir(), 'interview-backend-')),
      sources: () => [],
      interviewer: () => {
        built++
        return interviewer
      },
    })()

    expect(built).toBe(0)
    expect(backend.interviewer()).toBe(interviewer)
    expect(backend.interviewer()).toBe(interviewer)
    expect(built).toBe(1)
    expect(backend.newId()).not.toBe(backend.newId())
  })
})
