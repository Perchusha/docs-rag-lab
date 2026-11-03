import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EVAL_REPORT_VERSION } from '@docs-rag-lab/contracts'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  isSidecarName,
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
  ...(answers
    ? {
        answers: {
          models: {},
          prompts: {},
          rows: [],
          comparisons: [],
          answers: [],
          verdicts: [],
          support: [],
        },
      }
    : {}),
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
    agreement: [],
    labelled: 2,
  })
  write('2026-11-02-abcdef12-first-calibration-fresh.json', {
    report: { createdAt: '2026-11-02T00:00:00Z' },
    agreement: [],
    labelled: 1,
  })
  write('2026-11-03-abcdef12-answers-verify.json', {
    status: 'identical',
    changedVectors: [],
    rerun: { repoSha: 'abc', at: 'then' },
  })
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
    expect(listRuns(root, 'demo').runs).toEqual([
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
    expect(listRuns(root, 'other')).toEqual({ runs: [], unreadable: [] })
  })

  it.each([
    ['bad JSON', '{ not json'],
    ['another version', JSON.stringify({ ...report('old', 'x'), version: 0 })],
  ])('lists the rest when a report holds %s, and names it', (_name, content) => {
    writeFileSync(join(reportsDir(root, 'demo'), '2026-11-02-abcdef12-bad.json'), content)

    const { runs, unreadable } = listRuns(root, 'demo')

    expect(runs.map(({ name }) => name)).toEqual(['answers', 'baseline'])
    expect(unreadable).toEqual(['2026-11-02-abcdef12-bad'])
  })
})

describe('isSidecarName', () => {
  it.each(['verify', 'pre-verify', 'calibration', 'calibration-fresh', 'old-calibration-fresh'])(
    'refuses %s, whose file would read as one next to a report',
    (name) => {
      expect(isSidecarName(name)).toBe(true)
    },
  )

  it.each(['baseline', 'answers-regraded', 'verifying', 'calibrations', 'm4-h1-h2'])(
    'lets %s through',
    (name) => {
      expect(isSidecarName(name)).toBe(false)
    },
  )
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
    expect(readCalibrations(root, 'demo').rounds.map(({ labelled }) => labelled)).toEqual([1, 2])
  })

  it('puts the first round before a later one on the same report, whatever the file order', () => {
    const round = (labelled: number) => ({
      report: { createdAt: '2026-11-03T00:00:00Z' },
      agreement: [],
      labelled,
    })
    write('2026-11-03-abcdef12-answers-calibration.json', round(15))
    write('2026-11-03-abcdef12-answers-calibration-fresh.json', round(10))

    expect(readCalibrations(root, 'demo').rounds.map(({ labelled }) => labelled)).toEqual([
      1, 15, 10,
    ])
  })

  it('says which calibration it could not read, and reads the rest', () => {
    writeFileSync(
      join(reportsDir(root, 'demo'), '2026-11-03-abcdef12-x-calibration.json'),
      '{ not json',
    )
    write('2026-11-03-abcdef12-y-calibration.json', { labelled: 3 })

    const { rounds, unreadable } = readCalibrations(root, 'demo')

    expect(rounds).toHaveLength(2)
    expect(unreadable).toEqual([
      '2026-11-03-abcdef12-x-calibration',
      '2026-11-03-abcdef12-y-calibration',
    ])
  })

  it.each([
    ['bad JSON', '{ not json'],
    ['the wrong outline', '{"status":"identical"}'],
  ])('reads a verify record with %s as none recorded', (_name, content) => {
    writeFileSync(
      join(reportsDir(root, 'demo'), '2026-11-01-abcdef12-baseline-verify.json'),
      content,
    )

    expect(readVerifyRecord(root, 'demo', '2026-11-01-abcdef12-baseline')).toBeNull()
  })

  it('reads a verify record, or null when none was recorded', () => {
    expect(readVerifyRecord(root, 'demo', '2026-11-03-abcdef12-answers')?.status).toBe('identical')
    expect(readVerifyRecord(root, 'demo', '2026-11-01-abcdef12-baseline')).toBeNull()
  })

  it('puts the verify record next to its report', () => {
    expect(verifyRecordPath('a/b.json')).toBe('a/b-verify.json')
  })
})
