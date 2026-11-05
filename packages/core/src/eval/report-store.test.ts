import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EVAL_REPORT_VERSION } from '@docs-rag-lab/contracts'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { goldenSetHash } from './golden.ts'
import {
  archivedSets,
  goldenSetPath,
  goldenSetPathFor,
  isSidecarName,
  listRuns,
  readCalibrations,
  reportSources,
  readRun,
  readSourceAbout,
  readSpotCheck,
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

describe('the set a report names', () => {
  const evalDir = () => join(root, 'packages', 'sources', 'demo', 'eval')
  const setText = (question: string) =>
    `${JSON.stringify({ id: 'q-0001', question, answer: 'A.', tags: ['unanswerable'] })}\n`

  beforeEach(() => {
    mkdirSync(evalDir(), { recursive: true })
    writeFileSync(join(evalDir(), 'questions.jsonl'), setText('Now?'))
    writeFileSync(join(evalDir(), 'questions.v1.jsonl'), setText('Then?'))
    writeFileSync(join(evalDir(), 'questions.v10.jsonl'), setText('Much later?'))
  })

  it('lists the earlier versions kept beside the set, by version', () => {
    expect(archivedSets(root, 'demo').map(({ version }) => version)).toEqual([1, 10])
  })

  it('is the current file or an earlier version, by hash, and undefined for an unknown hash', () => {
    expect(goldenSetPathFor(root, 'demo', goldenSetHash(setText('Now?')))).toBe(
      goldenSetPath(root, 'demo'),
    )
    expect(goldenSetPathFor(root, 'demo', goldenSetHash(setText('Then?')))).toBe(
      join(evalDir(), 'questions.v1.jsonl'),
    )
    expect(goldenSetPathFor(root, 'demo', 'unknown')).toBeUndefined()
  })
})

describe('what a source says beside its numbers', () => {
  const writeAbout = (text: string): void => {
    const dir = join(root, 'packages', 'sources', 'demo', 'eval')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'about.json'), text)
  }

  it('is nothing when the source has no such file', () => {
    expect(readSourceAbout(root, 'demo')).toEqual({})
  })

  it('is read from the source, next to its set', () => {
    writeAbout(JSON.stringify({ set: 'Drafted.', staysOnHybrid: 'Because.' }))

    expect(readSourceAbout(root, 'demo')).toEqual({ set: 'Drafted.', staysOnHybrid: 'Because.' })
  })

  it('is an error when it cannot be read, so that nothing an ADR asks for goes missing quietly', () => {
    writeAbout(JSON.stringify({ set: 1 }))

    expect(() => readSourceAbout(root, 'demo')).toThrow('set must be a string')
  })
})

describe('a spot check', () => {
  const spot = {
    report: { createdAt: '2026-11-03T00:00:00Z' },
    agreement: [],
    supportDisagreements: [],
    allowed: 1,
    passed: true,
  }

  it('is read next to its report, and is neither a run nor a calibration', () => {
    write('2026-11-01-abcdef12-baseline-spot-check.json', spot)

    expect(readSpotCheck(root, 'demo', '2026-11-01-abcdef12-baseline')).toEqual(spot)
    expect(listRuns(root, 'demo').runs.map(({ id }) => id)).not.toContain(
      '2026-11-01-abcdef12-baseline-spot-check',
    )
    expect(readCalibrations(root).rounds.map(({ labelled }) => labelled)).toEqual([1, 2])
  })

  it('is null when there is none, or it cannot be read', () => {
    expect(readSpotCheck(root, 'demo', '2026-11-01-abcdef12-baseline')).toBeNull()

    write('2026-11-01-abcdef12-baseline-spot-check.json', { agreement: [] })

    expect(readSpotCheck(root, 'demo', '2026-11-01-abcdef12-baseline')).toBeNull()
  })

  it('gives its name to no run', () => {
    expect(isSidecarName('x-spot-check')).toBe(true)
  })
})

describe('sidecars', () => {
  it('reads every calibration, oldest report first', () => {
    expect(readCalibrations(root).rounds.map(({ labelled }) => labelled)).toEqual([1, 2])
  })

  it('reads the calibrations of every source, and notes which each came from', () => {
    const other = reportsDir(root, 'other')
    mkdirSync(join(other, 'dev'), { recursive: true })
    writeFileSync(
      join(other, '1999-01-01-abcdef12-z-calibration.json'),
      JSON.stringify({ report: { createdAt: '1999-01-01T00:00:00Z' }, agreement: [], labelled: 7 }),
    )

    expect(reportSources(root)).toEqual(['demo', 'other'])
    expect(readCalibrations(root).rounds.map((round) => [round.labelled, round.sourceId])).toEqual([
      [7, 'other'],
      [1, 'demo'],
      [2, 'demo'],
    ])
  })

  it('puts the first round before a later one on the same report, whatever the file order', () => {
    const round = (labelled: number) => ({
      report: { createdAt: '2026-11-03T00:00:00Z' },
      agreement: [],
      labelled,
    })
    write('2026-11-03-abcdef12-answers-calibration.json', round(15))
    write('2026-11-03-abcdef12-answers-calibration-fresh.json', round(10))

    expect(readCalibrations(root).rounds.map(({ labelled }) => labelled)).toEqual([1, 15, 10])
  })

  it('says which calibration it could not read, and reads the rest', () => {
    writeFileSync(
      join(reportsDir(root, 'demo'), '2026-11-03-abcdef12-x-calibration.json'),
      '{ not json',
    )
    write('2026-11-03-abcdef12-y-calibration.json', { labelled: 3 })

    const { rounds, unreadable } = readCalibrations(root)

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
