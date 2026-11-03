import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EVAL_REPORT_VERSION } from '@docs-rag-lab/contracts'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  listRuns,
  readCalibrations,
  readRun,
  readVerifyRecord,
  reportsDir,
  UnknownRunError,
  verifyRecordPath,
} from './report-store.ts'

let root: string

const report = (name: string | null, createdAt: string, answers = false) => ({
  version: EVAL_REPORT_VERSION,
  identity: { goldenSet: {}, docs: {} },
  vectors: {},
  result: { strategies: [], targets: [] },
  run: { name, createdAt, repoSha: 'abcdef1234567890' },
  ...(answers ? { answers: {} } : {}),
})

function write(name: string, value: unknown): void {
  writeFileSync(join(reportsDir(root, 'demo'), name), JSON.stringify(value))
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'drl-store-'))
  mkdirSync(join(reportsDir(root, 'demo'), 'dev'), { recursive: true })
  write('2026-11-01-abcdef12-baseline.json', report('baseline', '2026-11-01T00:00:00Z'))
  write('2026-11-03-abcdef12-answers.json', report('answers', '2026-11-03T00:00:00Z', true))
  write('2026-11-03-abcdef12-answers.md', 'markdown')
  write('2026-11-03-abcdef12-answers-calibration.json', {
    report: { createdAt: '2026-11-03T00:00:00Z' },
    labelled: 2,
  })
  write('2026-11-02-abcdef12-first-calibration-fresh.json', {
    report: { createdAt: '2026-11-02T00:00:00Z' },
    labelled: 1,
  })
  write('2026-11-03-abcdef12-answers-verify.json', { status: 'identical' })
  writeFileSync(
    join(reportsDir(root, 'demo'), 'dev', '2026-11-03-abcdef12-dev.json'),
    JSON.stringify(report(null, 'now')),
  )
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('listRuns', () => {
  it('lists named runs, newest first, without development runs or sidecars', () => {
    expect(listRuns(root, 'demo')).toEqual([
      {
        id: '2026-11-03-abcdef12-answers',
        name: 'answers',
        createdAt: '2026-11-03T00:00:00Z',
        sha: 'abcdef12',
        hasAnswers: true,
      },
      {
        id: '2026-11-01-abcdef12-baseline',
        name: 'baseline',
        createdAt: '2026-11-01T00:00:00Z',
        sha: 'abcdef12',
        hasAnswers: false,
      },
    ])
  })

  it('has nothing to list for a source with no reports', () => {
    expect(listRuns(root, 'other')).toEqual([])
  })
})

describe('readRun', () => {
  it('reads a listed run', () => {
    expect(readRun(root, 'demo', '2026-11-01-abcdef12-baseline').run.name).toBe('baseline')
  })

  it.each([
    ['an unknown ID', 'nope'],
    ['a sidecar', '2026-11-03-abcdef12-answers-calibration'],
    ['a way out of the folder', '../../../../secret'],
    ['a development run', 'dev/2026-11-03-abcdef12-dev'],
  ])('refuses %s, so a request cannot reach any other path', (_name, id) => {
    expect(() => readRun(root, 'demo', id)).toThrow(UnknownRunError)
  })

  it('refuses a file of another report version', () => {
    write('2026-11-02-abcdef12-old.json', { ...report('old', 'x'), version: 0 })

    expect(() => readRun(root, 'demo', '2026-11-02-abcdef12-old')).toThrow('version')
  })
})

describe('sidecars', () => {
  it('reads every calibration, oldest report first', () => {
    expect(readCalibrations(root, 'demo').map(({ labelled }) => labelled)).toEqual([1, 2])
  })

  it('reads a verify record, or null when none was recorded', () => {
    expect(readVerifyRecord(root, 'demo', '2026-11-03-abcdef12-answers')?.status).toBe('identical')
    expect(readVerifyRecord(root, 'demo', '2026-11-01-abcdef12-baseline')).toBeNull()
  })

  it('puts the verify record next to its report', () => {
    expect(verifyRecordPath('a/b.json')).toBe('a/b-verify.json')
  })
})
