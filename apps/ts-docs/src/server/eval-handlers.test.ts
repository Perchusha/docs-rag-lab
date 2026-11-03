import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EVAL_REPORT_VERSION } from '@docs-rag-lab/contracts'
import { goldenSetPath, reportsDir, type DashboardStore } from '@docs-rag-lab/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { handleEvalCompare, handleEvalDetails, handleEvalRun } from './eval-handlers.ts'

const ID = '2026-11-03-abcdef12-baseline'

const report = {
  version: EVAL_REPORT_VERSION,
  identity: {
    sourceId: 'demo',
    docs: { repo: 'r', branch: 'main', sha: 'docs-sha' },
    goldenSet: { version: 1, hash: 'set-hash' },
    retrieval: {},
  },
  vectors: { queryHash: 'q', corpusHash: 'c' },
  result: {
    scored: 0,
    stale: [],
    review: [],
    unanswerable: [],
    strategies: [],
    comparison: null,
    targets: [],
    chunks: {},
  },
  run: { name: 'baseline', createdAt: 'now', repoSha: 'abcdef1234567890', repoDirty: false },
}

let store: DashboardStore

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), 'drl-eval-handlers-'))
  store = { root, dataDir: join(root, 'data'), sourceId: 'demo' }
  mkdirSync(reportsDir(root, 'demo'), { recursive: true })
  writeFileSync(join(reportsDir(root, 'demo'), `${ID}.json`), JSON.stringify(report))
  const questions = goldenSetPath(root, 'demo')
  mkdirSync(join(questions, '..'), { recursive: true })
  writeFileSync(
    questions,
    `${JSON.stringify({ id: 'ts-0001', question: 'Q?', answer: 'A.', tags: ['unanswerable'] })}\n`,
  )
})

afterEach(() => {
  rmSync(store.root, { recursive: true, force: true })
  vi.restoreAllMocks()
})

const request = (query: string): Request => new Request(`http://127.0.0.1/api/eval?${query}`)

describe('the eval routes', () => {
  it('serve a run, with no index needed', async () => {
    const response = handleEvalRun(store, request(`run=${ID}`))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      id: ID,
      name: 'baseline',
      answers: null,
      trust: { indexDocsSha: null, verify: null },
    })
  })

  it('serve what opens behind the first screen', async () => {
    const response = handleEvalDetails(store, request(`run=${ID}`))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      questions: [{ id: 'ts-0001', question: 'Q?' }],
      candidates: [],
    })
  })

  it('compare two runs', async () => {
    const response = handleEvalCompare(store, request(`a=${ID}&b=${ID}`))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      comparable: true,
      a: 'baseline (1)',
      b: 'baseline (2)',
    })
  })

  it.each([
    ['run', handleEvalRun],
    ['details', handleEvalDetails],
  ])('need a run parameter on %s', async (_name, handler) => {
    const response = handler(store, request(''))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'the run parameter is required' })
  })

  it('need both runs to compare', () => {
    expect(handleEvalCompare(store, request(`a=${ID}`)).status).toBe(400)
  })

  it.each([
    ['an unknown run', 'nope'],
    ['a way out of the folder', '../../../secret'],
  ])('answer 404 to %s', async (_name, run) => {
    const response = handleEvalRun(store, request(`run=${encodeURIComponent(run)}`))

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: `there is no run "${run}"` })
  })

  it('call nothing outside the machine', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    handleEvalRun(store, request(`run=${ID}`))
    handleEvalDetails(store, request(`run=${ID}`))
    handleEvalCompare(store, request(`a=${ID}&b=${ID}`))

    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
