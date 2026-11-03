// `drl eval` end to end, over a seeded index in a real git repository in the OS temp
// dir. Every query vector is already in the cache, so nothing reaches the network.
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { EvalReport } from '@docs-rag-lab/contracts'
import {
  CHUNKER_VERSION,
  createEmbeddingProvider,
  embeddingCacheKey,
  openIndexes,
} from '@docs-rag-lab/core'
import { settings } from '@docs-rag-lab/settings'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { reportsDir } from './eval-commands.ts'
import { goldenSetPath, goldenTargetsPath } from './golden.ts'
import { run } from './run.ts'

// Each test runs git and several commands, which is slow when the whole repo's tests run at once.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 })

let root: string

function capture() {
  let text = ''
  return {
    writer: {
      write: (chunk: string) => {
        text += chunk
        return true
      },
    },
    text: () => text,
  }
}

let clock = Date.UTC(2026, 10, 3, 12)

async function drl(...argv: string[]) {
  const out = capture()
  const err = capture()
  const code = await run(argv, {
    out: out.writer,
    err: err.writer,
    root,
    debug: false,
    now: () => clock,
  })
  return { code, out: out.text(), err: err.text() }
}

const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: root, stdio: 'pipe', encoding: 'utf8' }).trim()

const QUESTIONS = ['First?', 'Second?']

function seedIndex(): void {
  const { dimensions } = settings.embeddings
  const providerId = createEmbeddingProvider(settings.embeddings).id
  const unit = (i: number) => Float32Array.from({ length: dimensions }, (_, j) => (j === i ? 1 : 0))
  const chunk = (id: string, i: number) => ({
    id,
    ordinal: i,
    headingPath: [id],
    anchor: id,
    blockTypes: ['prose'],
    text: `A > ${id}\n\nText of ${id}.`,
    metadata: { anchors: [id] },
    tokenCount: 5,
    textHash: id,
    vector: unit(i),
  })
  const indexes = openIndexes(join(root, settings.dataDir), 'typescript')
  indexes.index.applyChanges({
    documents: [
      {
        path: 'docs/a.md',
        url: 'https://x.dev/a',
        title: 'A',
        docType: 'handbook',
        contentHash: 'h',
        lastChangedSha: 's',
        chunks: [chunk('one', 0), chunk('two', 1)],
      },
    ],
    deletePaths: [],
    manifest: {
      sourceId: 'typescript',
      repo: 'r',
      branch: 'v2',
      includePaths: [],
      commitSha: 'docs-sha-docs-sha-docs-sha',
      syncedAt: '2026-11-03T00:00:00.000Z',
      embedModel: providerId,
      embedDimensions: dimensions,
      contextModel: null,
      chunkerVersion: CHUNKER_VERSION,
      parserVersion: 1,
    },
  })
  // The first question's vector is nearest the first chunk, the second's nearest the second.
  indexes.cache.putMany(
    QUESTIONS.map((question, i) => ({
      key: embeddingCacheKey(providerId, 'query', question),
      provider: providerId,
      inputType: 'query',
      vector: unit(i),
    })),
  )
  indexes.close()
}

function writeGoldenSet(answer = 'A.'): void {
  const path = goldenSetPath(root, 'typescript')
  mkdirSync(join(path, '..'), { recursive: true })
  const rows = [
    { id: 'ts-0001', question: 'First?', answer, primary: ['docs/a.md#one'], tags: ['basic'] },
    { id: 'ts-0002', question: 'Second?', answer, primary: ['docs/a.md#two'], tags: ['edge'] },
    { id: 'ts-0003', question: 'Not covered?', answer: 'No.', tags: ['unanswerable'] },
  ]
  writeFileSync(path, rows.map((row) => JSON.stringify(row)).join('\n') + '\n')
}

function commitAll(): void {
  git('add', '-A')
  git('commit', '--quiet', '-m', 'state')
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'drl-eval-run-'))
  writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages: []\n')
  writeFileSync(join(root, '.gitignore'), 'data/\neval/reports/*/dev/\n')
  const gitConfig = join(root, '.gitconfig-test')
  writeFileSync(gitConfig, '[user]\n\tname = Test\n\temail = test@example.com\n')
  vi.stubEnv('GIT_CONFIG_GLOBAL', gitConfig)
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1')
  vi.stubEnv('VOYAGE_API_KEY', 'pa-test')
  git('init', '--quiet', '-b', 'main')
  seedIndex()
  writeGoldenSet()
  await drl('eval', 'check', '--accept')
  commitAll()
  clock = Date.UTC(2026, 10, 3, 12)
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(root, { recursive: true, force: true })
})

const reportFiles = (sub = ''): string[] => {
  const dir = join(reportsDir(root, 'typescript'), sub)
  return existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith('.json')) : []
}
const readReport = (path: string): EvalReport =>
  JSON.parse(readFileSync(path, 'utf8')) as EvalReport
const reportPathIn = (out: string): string => {
  const path = /report: (.+)/.exec(out)?.[1]
  if (path === undefined) throw new Error(`no report in: ${out}`)
  return path
}

describe('drl eval', () => {
  it('measures both strategies and writes a development run under dev/, with no API call', async () => {
    const { code, out } = await drl('eval')

    expect(code).toBe(0)
    expect(out).toContain(
      'golden set v1, docs docs-sha: 2 questions scored, 1 unanswerable left out',
    )
    expect(out).toContain('0 tokens in 0 requests, 6 cached')
    expect(reportFiles('dev')).toHaveLength(1)
    expect(reportFiles()).toEqual([])

    const report = readReport(reportPathIn(out))
    expect(report.run).toMatchObject({
      name: null,
      repoSha: git('rev-parse', 'HEAD'),
      repoDirty: false,
    })
    expect(report.result.strategies.map(({ strategy }) => strategy)).toEqual(['vector', 'hybrid'])
    expect(report.result.strategies[0]?.overall.primary.hits[1]).toBe(2)
    expect(report.result.unanswerable).toEqual(['ts-0003'])
    expect(git('status', '--porcelain')).toBe('')
  })

  it('writes markdown next to the JSON, with the primary numbers first', async () => {
    const { out } = await drl('eval')
    const markdown = readFileSync(reportPathIn(out).replace(/\.json$/, '.md'), 'utf8')

    expect(markdown).toContain('# Eval report: development run')
    expect(markdown.indexOf('## Primary anchors')).toBeLessThan(
      markdown.indexOf('## With acceptable anchors (secondary)'),
    )
    expect(markdown).toContain('| vector | 2 | 2 | 2 | 2 | 2 | 1.000 | 1.000 |')
    expect(markdown).toContain('| ts-0001 | basic |')
  })

  it('runs one strategy on request', async () => {
    const { code, out } = await drl('eval', '--strategy', 'vector')

    expect(code).toBe(0)
    const report = readReport(reportPathIn(out))
    expect(report.result.strategies.map(({ strategy }) => strategy)).toEqual(['vector'])
    expect(report.result.comparison).toBeNull()
  })

  it('gives the same result twice, byte for byte', async () => {
    const first = readReport(reportPathIn((await drl('eval')).out))
    clock += 1000
    const second = readReport(reportPathIn((await drl('eval')).out))

    expect(JSON.stringify(second.result)).toBe(JSON.stringify(first.result))
    expect(second.identity).toEqual(first.identity)
    expect(second.vectors).toEqual(first.vectors)
  })

  it('reports the targets file when the source has one', async () => {
    writeFileSync(
      goldenTargetsPath(root, 'typescript'),
      JSON.stringify([{ questionId: 'ts-0001', anchor: 'docs/a.md#one', rank: 1 }]),
    )

    const { out } = await drl('eval')

    expect(out).toContain('target ts-0001 <= 1: vector 1, hybrid 1, met')
    expect(readReport(reportPathIn(out)).result.targets).toHaveLength(1)
  })

  describe('a named run', () => {
    it('writes where git sees it, stamped with the date and commit', async () => {
      const sha = git('rev-parse', 'HEAD').slice(0, 8)

      const { code, out } = await drl('eval', '--name', 'baseline')

      expect(code).toBe(0)
      expect(reportFiles()).toEqual([`2026-11-03-${sha}-baseline.json`])
      expect(readReport(reportPathIn(out)).run).toMatchObject({
        name: 'baseline',
        repoDirty: false,
      })
      expect(git('status', '--porcelain')).toContain('eval/')
    })

    it('needs a clean tree, and an untracked file counts', async () => {
      writeFileSync(join(root, 'untracked.ts'), 'export {}\n')

      const { code, err } = await drl('eval', '--name', 'baseline')

      expect(code).toBe(1)
      expect(err).toContain('a named run needs a clean tree')
      expect(reportFiles()).toEqual([])
    })

    it('marks a development run on a dirty tree as dirty', async () => {
      writeFileSync(join(root, 'untracked.ts'), 'export {}\n')

      const { out } = await drl('eval')

      expect(readReport(reportPathIn(out)).run.repoDirty).toBe(true)
    })

    it('counts a file git is told to hide from status as dirty', async () => {
      writeFileSync(join(root, 'untracked.ts'), 'export {}\n')
      git('config', 'status.showUntrackedFiles', 'no')

      const { code, err } = await drl('eval', '--name', 'baseline')

      expect(code).toBe(1)
      expect(err).toContain('a named run needs a clean tree')
    })

    it('needs every strategy, so that later runs can be compared', async () => {
      const { code, err } = await drl('eval', '--name', 'baseline', '--strategy', 'vector')

      expect(code).toBe(1)
      expect(err).toContain('a named run measures every strategy')
      expect(reportFiles()).toEqual([])
    })

    it('needs the docs to be where the lock says', async () => {
      const lockPath = join(root, goldenLockRelative())
      const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as { docsSha: string }
      writeFileSync(lockPath, JSON.stringify({ ...lock, docsSha: 'a'.repeat(40) }))
      commitAll()

      const { code, err } = await drl('eval', '--name', 'baseline')

      expect(code).toBe(1)
      expect(err).toContain('a named run needs a clean golden check')
    })

    it('never overwrites a report', async () => {
      const path = reportPathIn((await drl('eval', '--name', 'baseline')).out)
      const before = readFileSync(path, 'utf8')
      clock += 1000

      const { code, err } = await drl('eval', '--name', 'baseline')

      expect(code).toBe(1)
      expect(err).toContain('already exists')
      expect(readFileSync(path, 'utf8')).toBe(before)
    })

    it('needs a clean golden check', async () => {
      rmSync(join(root, goldenLockRelative()))
      commitAll()

      const { code, err } = await drl('eval', '--name', 'baseline')

      expect(code).toBe(1)
      expect(err).toContain('a named run needs a clean golden check')
    })

    it('takes lowercase words with hyphens as a name', async () => {
      const { code, err } = await drl('eval', '--name', 'Base Line')

      expect(code).toBe(1)
      expect(err).toContain('--name takes lowercase words with hyphens')
    })
  })

  it('refuses any run on a set that differs from its lock, since no version would fit', async () => {
    writeGoldenSet('A different answer.')

    const { code, out, err } = await drl('eval')

    expect(code).toBe(1)
    expect(out).toContain('the set changed since the lock, and it is frozen')
    expect(err).toContain('the golden set differs from its lock')
    expect(reportFiles('dev')).toEqual([])
  })

  it('takes --name only with eval, and refuses an unknown subcommand', async () => {
    const misplaced = await drl('search', 'q', '--name', 'x')
    expect(misplaced.code).toBe(2)
    expect(misplaced.err).toContain('--name works only with eval')

    const unknown = await drl('eval', 'nope')
    expect(unknown.code).toBe(1)
    expect(unknown.err).toContain('unknown eval command "nope"')
  })

  it.each([
    [['eval', '--top-k', '3'], '--top-k'],
    [['eval', '--doc-type', 'option'], '--doc-type'],
    [['eval', '--accept'], '--accept'],
    [['eval', 'check', '--name', 'x'], '--name'],
    [['eval', 'check', '--strategy', 'vector'], '--strategy'],
    [['eval', 'verify', 'x.json', '--strategy', 'vector'], '--strategy'],
  ])('refuses a flag it would ignore: %j', async (argv, flag) => {
    const { code, err } = await drl(...argv)

    expect(code).toBe(1)
    expect(err).toContain(`${flag} does not apply to drl eval`)
  })
})

function goldenLockRelative(): string {
  return join('packages', 'sources', 'typescript', 'eval', 'questions.lock.json')
}

describe('drl eval verify', () => {
  it('says a report reproduces byte for byte, at the same commit', async () => {
    const path = reportPathIn((await drl('eval', '--name', 'baseline')).out)

    const { code, out } = await drl('eval', 'verify', path)

    expect(code).toBe(0)
    expect(out).toContain('re-run at')
    expect(out).toContain(
      'reproduced: what was measured matches the report byte for byte, on the same vectors',
    )
    expect(out).toContain('with uncommitted changes')
  })

  it('fails on a report whose numbers were changed', async () => {
    const path = reportPathIn((await drl('eval')).out)
    const report = readReport(path)
    const [first] = report.result.strategies
    if (first === undefined) throw new Error('no strategy')
    first.overall.primary.hits[1] = 1
    writeFileSync(path, JSON.stringify(report))

    const { code, out, err } = await drl('eval', 'verify', path)

    expect(code).toBe(1)
    expect(out).toContain('the code and the vectors are the same, and the result is not')
    expect(err).toContain('the report did not reproduce')
  })

  it('names the commit to sync when the docs differ', async () => {
    const path = reportPathIn((await drl('eval')).out)
    const report = readReport(path)
    report.identity.docs.sha = 'a'.repeat(40)
    writeFileSync(path, JSON.stringify(report))

    const { code, out, err } = await drl('eval', 'verify', path)

    expect(code).toBe(1)
    expect(out).toContain('not comparable')
    expect(out).toContain('identity.docs.sha')
    expect(err).toContain(`drl sync typescript --at ${'a'.repeat(40)}`)
  })

  it('reproduces byte for byte with other vector hashes, when nothing measured moved', async () => {
    const path = reportPathIn((await drl('eval')).out)
    const report = readReport(path)
    report.vectors.corpusHash = 'other'
    writeFileSync(path, JSON.stringify(report))

    const { code, out } = await drl('eval', 'verify', path)

    expect(code).toBe(0)
    expect(out).toContain('byte for byte, on other corpus vectors')
  })

  /** A stored report as other vectors would have left it: an anchor deep below the context. */
  function withDeepAnchor(report: EvalReport): void {
    report.vectors.corpusHash = 'other'
    const question = report.result.strategies[0]?.questions[0]
    if (question === undefined) throw new Error('no question')
    question.anchors.push({ anchor: 'docs/a.md#deep', role: 'acceptable', rank: 40 })
  }

  it('calls other vectors reproduced at the same commit, when only deep ranks moved', async () => {
    const path = reportPathIn((await drl('eval')).out)
    const report = readReport(path)
    withDeepAnchor(report)
    writeFileSync(path, JSON.stringify(report))

    const { code, out } = await drl('eval', 'verify', path)

    expect(code).toBe(0)
    expect(out).toContain('reproduced: other corpus vectors')
    expect(out).toContain('ranks below the context moved on: vector ts-0001')
  })

  it('calls other vectors and other code inconclusive, since it cannot tell them apart', async () => {
    const path = reportPathIn((await drl('eval')).out)
    const report = readReport(path)
    withDeepAnchor(report)
    report.run.repoSha = 'a'.repeat(40)
    writeFileSync(path, JSON.stringify(report))

    const { code, out, err } = await drl('eval', 'verify', path)

    expect(code).toBe(1)
    expect(out).toContain('inconclusive')
    expect(err).toContain('with a clean tree to tell code from vectors')
  })

  it('calls a rank that moved inside the context different, with other vectors too', async () => {
    const path = reportPathIn((await drl('eval')).out)
    const report = readReport(path)
    report.vectors.corpusHash = 'other'
    const anchor = report.result.strategies[0]?.questions[0]?.anchors[0]
    if (anchor === undefined) throw new Error('no anchor')
    anchor.rank = 5
    writeFileSync(path, JSON.stringify(report))

    const { code, out } = await drl('eval', 'verify', path)

    expect(code).toBe(1)
    expect(out).toContain('not reproduced, with other corpus vectors')
    expect(out).toContain('from rank 5 to 1')
  })

  it('says when the stored report came from a dirty tree', async () => {
    const path = reportPathIn((await drl('eval')).out)
    const report = readReport(path)
    report.run.repoDirty = true
    writeFileSync(path, JSON.stringify(report))

    const { out } = await drl('eval', 'verify', path)

    expect(out).toMatch(/report from \w+ with uncommitted changes/)
  })

  it.each([['no such file', (path: string) => `${path}.missing`, 'no report at']])(
    'refuses %s',
    async (_name, change, message) => {
      const path = reportPathIn((await drl('eval')).out)

      const { code, err } = await drl('eval', 'verify', change(path))

      expect(code).toBe(1)
      expect(err).toContain(message)
    },
  )

  it('refuses a file that is not a report, and asks for a path', async () => {
    const path = join(root, 'not-a-report.json')
    writeFileSync(path, '{"version": 99}')

    const wrong = await drl('eval', 'verify', path)
    expect(wrong.code).toBe(1)
    expect(wrong.err).toContain('this report has version 99')

    writeFileSync(path, 'nope')
    const broken = await drl('eval', 'verify', path)
    expect(broken.err).toContain('is not valid JSON')

    const none = await drl('eval', 'verify')
    expect(none.err).toContain('eval verify needs a report file')
  })
})

describe('drl eval compare', () => {
  async function twoRuns() {
    const a = reportPathIn((await drl('eval')).out)
    clock += 1000
    const b = reportPathIn((await drl('eval')).out)
    return { a, b }
  }

  it('compares each strategy, with no difference between two equal runs', async () => {
    const { a, b } = await twoRuns()

    const { code, out } = await drl('eval', 'compare', a, b)

    expect(code).toBe(0)
    expect(out).toContain('vector:')
    expect(out).toContain('hybrid:')
    expect(out).toContain('no primary rank moved')
    expect(out).toContain('usage: no API calls')
  })

  it('lists the ranks that moved, and calls a difference on 2 questions too few to say', async () => {
    const { a, b } = await twoRuns()
    const report = readReport(b)
    const [vector] = report.result.strategies
    const [first] = vector?.questions ?? []
    if (first === undefined) throw new Error('no question')
    first.primaryRank = 3
    writeFileSync(b, JSON.stringify(report))

    const { out } = await drl('eval', 'compare', a, b)

    expect(out).toContain('ts-0001: 1 -> 3')
    expect(out).toContain('too few to say')
  })

  it('refuses reports of two set versions: numbers from two versions are never compared', async () => {
    const { a, b } = await twoRuns()
    const report = readReport(b)
    report.identity.goldenSet.version = 2
    writeFileSync(b, JSON.stringify(report))

    const { code, err } = await drl('eval', 'compare', a, b)

    expect(code).toBe(1)
    expect(err).toContain('never compared')
  })

  it('refuses reports of one version number with different contents', async () => {
    const { a, b } = await twoRuns()
    const report = readReport(b)
    report.identity.goldenSet.hash = 'other'
    writeFileSync(b, JSON.stringify(report))

    expect((await drl('eval', 'compare', a, b)).code).toBe(1)
  })

  it('says when the docs differ, and when there is no strategy in common', async () => {
    const { a, b } = await twoRuns()
    const report = readReport(b)
    report.identity.docs.sha = 'b'.repeat(40)
    writeFileSync(b, JSON.stringify(report))
    expect((await drl('eval', 'compare', a, b)).out).toContain('identity.docs.sha:')

    clock += 1000
    const one = reportPathIn((await drl('eval', '--strategy', 'vector')).out)
    clock += 1000
    const other = reportPathIn((await drl('eval', '--strategy', 'hybrid')).out)
    const { code, err } = await drl('eval', 'compare', one, other)
    expect(code).toBe(1)
    expect(err).toContain('no strategy in common')
  })

  it('says what else differs, since a rank change means little until that is known', async () => {
    const { a, b } = await twoRuns()
    const report = readReport(b)
    report.identity.retrieval.rrfK = 30
    report.identity.chunkerVersion = 99
    report.vectors.queryHash = 'other'
    report.run.name = 'after'
    writeFileSync(b, JSON.stringify(report))

    const { out } = await drl('eval', 'compare', a, b)

    expect(out).toContain('identity.retrieval.rrfK:')
    expect(out).toContain('identity.chunkerVersion:')
    expect(out).toContain('vectors.queryHash:')
    expect(out).toContain('with other vectors, ranks below the context can move by themselves')
    expect(out).toContain('@')
    expect(out).toContain('Compared question by question')
  })

  it('says when two reports measured the same thing on the same vectors', async () => {
    const { a, b } = await twoRuns()

    expect((await drl('eval', 'compare', a, b)).out).toContain(
      'these reports measured the same thing, on the same vectors',
    )
  })

  it('tells two reports with one name apart by commit', async () => {
    const { a, b } = await twoRuns()
    for (const path of [a, b]) {
      const report = readReport(path)
      report.run.name = 'baseline'
      writeFileSync(path, JSON.stringify(report))
    }
    const report = readReport(b)
    report.run.repoSha = 'b'.repeat(40)
    writeFileSync(b, JSON.stringify(report))

    expect((await drl('eval', 'compare', a, b)).out).toContain(`@${'b'.repeat(8)}`)
  })

  it('names the questions only one report scored', async () => {
    const { a, b } = await twoRuns()
    const report = readReport(b)
    for (const strategy of report.result.strategies) strategy.questions.pop()
    writeFileSync(b, JSON.stringify(report))

    expect((await drl('eval', 'compare', a, b)).out).toContain('scored by only one report: ts-0002')
  })

  it('refuses reports of two sources', async () => {
    const { a, b } = await twoRuns()
    const report = readReport(b)
    report.identity.sourceId = 'react'
    writeFileSync(b, JSON.stringify(report))

    const { code, err } = await drl('eval', 'compare', a, b)

    expect(code).toBe(1)
    expect(err).toContain('different sources: typescript and react')
  })

  it('asks for two files', async () => {
    const { err } = await drl('eval', 'compare', 'one.json')

    expect(err).toContain('eval compare needs two report files')
  })
})
