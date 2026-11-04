import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EVAL_REPORT_VERSION, type DashboardRunEntry } from '@docs-rag-lab/contracts'
import { openSourceIndex } from '@docs-rag-lab/db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { sourceIndexPath } from '../indexes.ts'
import { strategyResult } from './metrics.ts'
import {
  dashboardPage,
  dashboardRuns,
  defaultRun,
  loadDashboardRun,
  runToShow,
} from './dashboard-store.ts'
import { reportsDir } from './report-store.ts'

const entry = (id: string, hasAnswers = false): DashboardRunEntry => ({
  id,
  name: id,
  createdAt: 'then',
  sha: 'abcdef12',
  hasAnswers,
})

describe('defaultRun', () => {
  it('takes the newest with answers, or else the newest', () => {
    expect(defaultRun([entry('a'), entry('b', true)])?.id).toBe('b')
    expect(defaultRun([entry('a'), entry('b')])?.id).toBe('a')
    expect(defaultRun([])).toBeUndefined()
  })
})

describe('runToShow', () => {
  const runs = [entry('a'), entry('b', true)]

  it('shows what was asked for', () => {
    expect(runToShow(runs, 'a')).toEqual({ shown: runs[0], missing: undefined })
  })

  it('shows the default when nothing was asked for, with nothing to say about it', () => {
    expect(runToShow(runs, undefined)).toEqual({ shown: runs[1], missing: undefined })
  })

  it('shows the default for a name no run has, and keeps the name so the page can say so', () => {
    expect(runToShow(runs, 'typo')).toEqual({ shown: runs[1], missing: 'typo' })
  })

  it('takes the first of a parameter given twice', () => {
    expect(runToShow(runs, ['a', 'b']).shown?.id).toBe('a')
  })

  it('takes an empty parameter as nothing asked for', () => {
    expect(runToShow(runs, '')).toEqual({ shown: runs[1], missing: undefined })
  })
})

describe('row 5 of a report', () => {
  let root: string
  const answersId = '2026-11-04-abcdef12-answers'

  const scores = (rank: number) =>
    Array.from({ length: 10 }, (_, i) => ({
      id: `ts-${String(i + 1).padStart(4, '0')}`,
      tags: ['basic'],
      anchors: [{ anchor: 'a.md', role: 'primary' as const, rank }],
      primaryRank: rank,
      acceptableRank: rank,
      recallAt8: 1,
      context: [],
    }))

  const report = (name: string, chunksHash: string, rank: number, queryHash = 'q') => ({
    version: EVAL_REPORT_VERSION,
    identity: {
      goldenSet: { version: 1, hash: 'h' },
      docs: { sha: 's' },
      chunksHash,
      contextModel: null,
      rerank: { model: 'm', depth: 20 },
    },
    vectors: { queryHash, corpusHash: chunksHash },
    result: {
      scored: 10,
      stale: [],
      review: [],
      unanswerable: [],
      targets: [],
      chunks: {},
      strategies: [strategyResult('hybrid', scores(3)), strategyResult('rerank', scores(rank))],
    },
    run: { name, createdAt: '2026-11-04T00:00:00Z', repoSha: 'abcdef1234567890' },
  })

  const write = (id: string, value: object) => {
    writeFileSync(join(reportsDir(root, 'demo'), `${id}.json`), JSON.stringify(value))
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'drl-dashboard-row5-'))
    mkdirSync(reportsDir(root, 'demo'), { recursive: true })
    write(answersId, {
      ...report('answers', 'plain', 2),
      answers: {
        models: { answer: 'a', judge: 'j' },
        prompts: {},
        rows: [
          {
            row: 5,
            sample: 1,
            overall: {},
            byTag: {},
            refusals: {},
            excluded: { truncated: [], refused: [], failed: [], unjudged: [] },
          },
        ],
        comparisons: [],
        judgeRetest: null,
        candidates: [],
        contextualIndex: { rows: [5], contextModel: 'haiku:abc', chunksHash: 'contextual' },
        paidUsd: 0,
        answers: [],
        verdicts: [],
        support: [],
      },
    })
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  const thirdColumn = () =>
    loadDashboardRun({ root, dataDir: join(root, 'data'), sourceId: 'demo' }, answersId).retrieval
      .rows[0]?.figures[2]

  it('comes from the report that names the chunks it read', () => {
    write('2026-11-04-abcdef13-other', report('other', 'other', 9))
    write('2026-11-04-abcdef14-contextual', report('contextual', 'contextual', 1))

    expect(thirdColumn()).toMatchObject({ kind: 'share', count: 10, of: 10 })
  })

  it('does not come from one of the same chunks on other questions', () => {
    write('2026-11-04-abcdef14-contextual', report('contextual', 'contextual', 1, 'other-queries'))

    expect(thirdColumn()).toEqual({ kind: 'none', reason: 'in its own report' })
  })

  it('says where it is when there is no such report', () => {
    expect(thirdColumn()).toEqual({ kind: 'none', reason: 'in its own report' })
  })
})

describe('loading a run', () => {
  let root: string
  const id = '2026-11-03-abcdef12-baseline'

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'drl-dashboard-'))
    mkdirSync(reportsDir(root, 'demo'), { recursive: true })
    writeFileSync(
      join(reportsDir(root, 'demo'), `${id}.json`),
      JSON.stringify({
        version: EVAL_REPORT_VERSION,
        identity: { goldenSet: { version: 1, hash: 'h' }, docs: { sha: 's' } },
        vectors: {},
        result: { strategies: [], targets: [], stale: [], review: [] },
        run: { name: 'baseline', createdAt: '2026-11-03T00:00:00Z', repoSha: 'abcdef1234567890' },
      }),
    )
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  const store = () => ({ root, dataDir: join(root, 'data'), sourceId: 'demo' })

  it('creates nothing where there is no data yet', () => {
    expect(loadDashboardRun(store(), id).trust.indexDocsSha).toBeNull()
    expect(existsSync(join(root, 'data'))).toBe(false)
  })

  it.each([
    ['empty', ''],
    ['no database', 'this is no database, just text long enough to be read'],
  ])('shows the page with an index that is %s, and leaves it alone', (_name, content) => {
    const path = sourceIndexPath(store().dataDir, 'demo')
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, content)

    expect(loadDashboardRun(store(), id).trust.indexDocsSha).toBeNull()
    expect(readdirSync(join(path, '..'))).toEqual(['demo.sqlite'])
    expect(readdirSync(store().dataDir)).toEqual(['sources'])
  })

  it('says which commit the index is at, and opens no cache to find out', () => {
    const path = sourceIndexPath(store().dataDir, 'demo')
    mkdirSync(join(path, '..'), { recursive: true })
    const index = openSourceIndex(path)
    index.applyChanges({
      documents: [],
      deletePaths: [],
      manifest: {
        sourceId: 'demo',
        repo: 'file:///demo',
        branch: 'main',
        includePaths: ['docs'],
        commitSha: 'a'.repeat(40),
        syncedAt: '2026-10-31T00:00:00.000Z',
        embedModel: 'fake',
        embedDimensions: 4,
        contextModel: null,
        chunkerVersion: 1,
        parserVersion: 1,
      },
    })
    index.close()

    expect(loadDashboardRun(store(), id).trust.indexDocsSha).toBe('a'.repeat(40))
    expect(readdirSync(store().dataDir)).toEqual(['sources'])
  })

  describe('the page', () => {
    const write = (name: string, content: string) => {
      writeFileSync(join(reportsDir(root, 'demo'), name), content)
    }
    // It lists, since its outline is whole, and then it cannot build: a strategy with no results.
    const brokenBuild = JSON.stringify({
      version: EVAL_REPORT_VERSION,
      identity: { goldenSet: { version: 1, hash: 'h' }, docs: { sha: 's' } },
      vectors: {},
      result: { strategies: [{ strategy: 'vector' }], targets: [], stale: [], review: [] },
      run: { name: 'broken', createdAt: '2026-11-04T00:00:00Z', repoSha: 'abcdef1234567890' },
    })

    it('shows the next run when the one it would show cannot be built, and names it', () => {
      write('2026-11-04-abcdef12-broken.json', brokenBuild)

      const page = dashboardPage(store(), undefined)

      expect(page.initial?.id).toBe(id)
      expect(page.runs.map((run) => run.id)).toEqual([id])
      expect(page.unreadable).toEqual(['2026-11-04-abcdef12-broken'])
    })

    it('says it cannot read a run that was asked for by name, and not that there is none', () => {
      write('2026-11-02-abcdef12-bad.json', '{ not json')

      expect(dashboardPage(store(), '2026-11-02-abcdef12-bad')).toMatchObject({
        missing: undefined,
        unreadable: ['2026-11-02-abcdef12-bad'],
      })
      write('2026-11-04-abcdef12-broken.json', brokenBuild)
      expect(dashboardPage(store(), '2026-11-04-abcdef12-broken')).toMatchObject({
        missing: undefined,
        unreadable: ['2026-11-02-abcdef12-bad', '2026-11-04-abcdef12-broken'],
      })
    })

    it('still says when no run has the name asked for', () => {
      expect(dashboardPage(store(), 'typo')).toMatchObject({ missing: 'typo' })
    })

    it('has nothing to show when nothing can be read', () => {
      rmSync(join(reportsDir(root, 'demo'), `${id}.json`))
      write('2026-11-04-abcdef12-broken.json', brokenBuild)

      expect(dashboardPage(store(), undefined)).toEqual({
        runs: [],
        unreadable: ['2026-11-04-abcdef12-broken'],
        initial: undefined,
        missing: undefined,
      })
    })
  })

  it('lists a run, and names one it cannot read', () => {
    writeFileSync(join(reportsDir(root, 'demo'), '2026-11-02-abcdef12-bad.json'), '{ not json')

    expect(dashboardRuns(store())).toMatchObject({
      runs: [{ id }],
      unreadable: ['2026-11-02-abcdef12-bad'],
    })
  })
})
