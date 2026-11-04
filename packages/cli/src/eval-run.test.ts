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
  CONTROL_IDENTITY,
  createEmbeddingProvider,
  embeddingCacheKey,
  freshSampleForLabels,
  parseGoldenSet,
  newRowsSampleForLabels,
  sampleForLabels,
  sampleHash,
  type EvalClient,
  openIndexes,
  type IndexVariant,
  type RerankProvider,
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

type ClaudeRequest = Parameters<EvalClient['messages']['stream']>[0]
type ClaudeMessage = Awaited<
  ReturnType<ReturnType<EvalClient['messages']['stream']>['finalMessage']>
>

/** What the fake Claude was asked, and what it answers with. */
let claudeRequests: ClaudeRequest[] = []
let judgeBody: (system: string, text: string) => unknown = () => undefined

function fakeClaude(request: ClaudeRequest): ClaudeMessage {
  claudeRequests.push(request)
  const system = JSON.stringify(request.system)
  const text = JSON.stringify(request.messages)
  const judged = request.output_config?.format != null
  const usage = { input_tokens: 1000, output_tokens: 100 }
  const content = judged
    ? [{ type: 'text', text: JSON.stringify(judgeBody(system, text)), citations: null }]
    : [
        {
          type: 'text',
          text: 'SECRET ANSWER TEXT.',
          citations: text.includes('search_result')
            ? [
                {
                  type: 'search_result_location',
                  search_result_index: 0,
                  cited_text: 'SECRET PASSAGE.',
                  source: 's',
                  title: 't',
                  start_block_index: 0,
                  end_block_index: 1,
                },
              ]
            : null,
        },
      ]
  return {
    id: 'm',
    type: 'message',
    role: 'assistant',
    model: request.model,
    content,
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage,
  } as unknown as ClaudeMessage
}

const fakeEvalClient: EvalClient = {
  messages: {
    stream(request) {
      const message = fakeClaude(request)
      return {
        on: () => undefined,
        finalMessage: () => Promise.resolve(message),
        currentMessage: message,
      }
    },
    countTokens: () => Promise.resolve({ input_tokens: 1000 }),
  },
}

const SOUND_JUDGE = (system: string, text: string): unknown => {
  if (system.includes('You check the citations')) {
    return { claims: [{ claim: 1, reason: 'r', supported: true }] }
  }
  if (system.includes('does not answer the question below')) {
    return { reasoning: 'r', outcome: 'correct_refusal' }
  }
  return { reasoning: 'r', correctness: text.includes('First?') ? 2 : 1, false_refusal: false }
}

/** What reached the reranker, and how much each call shifts its scores. */
let rerankCalls: string[][] = []
let rerankJitter = 0
const fakeReranker: RerankProvider = {
  id: 'fake:rerank',
  model: 'fake-rerank',
  rerank: (_query, documents) => {
    rerankCalls.push([...documents])
    return Promise.resolve({
      scores: documents.map(
        (text) => (text.includes('two') ? 0.9 : 0.1) + rerankJitter * rerankCalls.length,
      ),
      tokens: 11,
    })
  },
}

// The real limits would make these tests wait a minute between calls.
const unlimited = {
  ...settings,
  rerank: { ...settings.rerank, rateLimit: { rpm: 1_000_000, tpm: 1_000_000_000 } },
}

async function drl(...argv: string[]) {
  const out = capture()
  const err = capture()
  const code = await run(argv, {
    settings: unlimited,
    out: out.writer,
    err: err.writer,
    root,
    debug: false,
    now: () => clock,
    createEvalClient: () => fakeEvalClient,
    createReranker: () => fakeReranker,
  })
  return { code, out: out.text(), err: err.text() }
}

const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: root, stdio: 'pipe', encoding: 'utf8' }).trim()

const QUESTIONS = ['First?', 'Second?', 'Not covered?']

/** The plain index, or another one with a context on each chunk and the same vectors. */
function seedIndex(variant?: IndexVariant): void {
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
    context: variant === undefined ? null : `Context of ${id}.`,
    metadata: { anchors: [id] },
    tokenCount: 5,
    textHash: id,
    vector: unit(i),
  })
  const indexes = openIndexes(join(root, settings.dataDir), 'typescript', { variant })
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
      contextModel:
        variant === undefined ? null : variant === 'control' ? CONTROL_IDENTITY : 'claude-test:abc',
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
    rerankCalls = []
    const { code, out } = await drl('eval')
    expect(rerankCalls).toEqual([])

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

  describe('drl eval rerank-check', () => {
    beforeEach(() => {
      rerankCalls = []
      rerankJitter = 0
    })

    it('prints the plan and stops, with no call, until --yes', async () => {
      const { code, out } = await drl('eval', 'rerank-check')
      expect(code).toBe(0)
      expect(out).toContain('calls to rerank-3 for ts-0001, ts-0002')
      expect(out).toContain('add --yes')
      expect(rerankCalls).toEqual([])
    })

    it('says what identical and different sets did, and writes no cache entry', async () => {
      const { code, out } = await drl('eval', 'rerank-check', '--yes')
      expect(code).toBe(0)
      expect(out).toContain('Identical sets: all')
      expect(out).toContain('Different sets: 0 of')
      expect(rerankCalls.length).toBeGreaterThan(2)
      const before = rerankCalls.length
      await drl('eval', 'rerank-check', '--yes')
      expect(rerankCalls.length).toBe(before * 2)
    })

    it('fails only when identical sets differ, since a run could then not be reproduced', async () => {
      rerankJitter = 0.001
      const { code, out, err } = await drl('eval', 'rerank-check', '--yes')
      expect(code).toBe(1)
      expect(out).toContain('Identical sets: ')
      expect(err).toContain('the same documents gave other scores')
    })
  })

  it('prints what a run would rerank and stops, until --yes, and needs none once it is cached', async () => {
    rerankCalls = []
    rerankJitter = 0
    const planned = await drl('eval', '--strategy', 'rerank')
    expect(planned.code).toBe(0)
    expect(planned.out).toContain('this would make 2 calls to rerank-3')
    expect(planned.out).toContain('add --yes')
    expect(rerankCalls).toEqual([])
    expect(planned.out).not.toContain('report:')

    expect((await drl('eval', '--strategy', 'rerank', '--yes')).code).toBe(0)
    expect(rerankCalls).toHaveLength(2)

    clock += 1000
    const cached = await drl('eval', '--strategy', 'rerank')
    expect(cached.out).toContain('report:')
    expect(rerankCalls).toHaveLength(2)
  })

  describe('the other indexes', () => {
    beforeEach(() => {
      rerankCalls = []
      rerankJitter = 0
    })

    it('says what to run when an index is not built yet', async () => {
      const { code, err } = await drl('eval', '--contextual')
      expect(code).toBe(1)
      expect(err).toContain('run drl sync typescript --contextual first')
    })

    it('measures the contextual index, reranks its contexts, and verifies against it', async () => {
      seedIndex('contextual')
      const { code, out } = await drl('eval', '--contextual', '--name', 'contextual', '--yes')
      expect(code).toBe(0)
      const path = reportPathIn(out)
      const report = readReport(path)
      expect(report.identity.contextModel).toBe('claude-test:abc')
      expect(report.result.strategies.map(({ strategy }) => strategy)).toEqual([
        'vector',
        'hybrid',
        'rerank',
      ])
      expect(rerankCalls).toHaveLength(2)
      expect(rerankCalls.flat().every((text) => text.startsWith('Context of '))).toBe(true)

      const verified = await drl('eval', 'verify', path)
      expect(verified.out).toContain('byte for byte')
      expect(rerankCalls).toHaveLength(2)
    })

    it('needs no --yes for what the contextual cache holds', async () => {
      seedIndex('contextual')
      const planned = await drl('eval', '--contextual', '--strategy', 'rerank')
      expect(planned.out).toContain('this would make 2 calls')
      await drl('eval', '--contextual', '--strategy', 'rerank', '--yes')
      clock += 1000
      const cached = await drl('eval', '--contextual', '--strategy', 'rerank')
      expect(cached.out).toContain('report:')
      expect(rerankCalls).toHaveLength(2)
    })

    it('measures the control under vector and hybrid only, with no rerank call', async () => {
      seedIndex('control')
      const { code, out } = await drl('eval', '--control', '--name', 'control')
      expect(code).toBe(0)
      const path = reportPathIn(out)
      const report = readReport(path)
      expect(report.identity.contextModel).toBe(CONTROL_IDENTITY)
      expect(report.identity).not.toHaveProperty('rerank')
      expect(report.result.strategies.map(({ strategy }) => strategy)).toEqual(['vector', 'hybrid'])
      expect(rerankCalls).toEqual([])

      const verified = await drl('eval', 'verify', path)
      expect(verified.out).toContain('byte for byte')
    })

    it('refuses to rerank the control, and flags with other commands', async () => {
      seedIndex('control')
      const reranked = await drl('eval', '--control', '--strategy', 'rerank', '--yes')
      expect(reranked.code).toBe(1)
      expect(reranked.err).toContain('the control is measured without the reranker')
      expect((await drl('eval', 'verify', 'x.json', '--control')).err).toContain(
        '--control does not apply',
      )
      expect((await drl('eval', '--strategies', 'hybrid,rerank')).err).toContain(
        '--strategies does not apply',
      )
    })
  })

  describe('compare, one strategy against another', () => {
    beforeEach(() => {
      rerankCalls = []
      rerankJitter = 0
    })

    it('compares what it is told to, within one report too', async () => {
      const path = reportPathIn((await drl('eval', '--name', 'baseline', '--yes')).out)
      const { code, out } = await drl(
        'eval',
        'compare',
        path,
        path,
        '--strategies',
        'hybrid,rerank',
      )
      expect(code).toBe(0)
      expect(out).toContain('hybrid against rerank: ')
      expect(out).not.toContain('\nvector: ')
    })

    it('says when a report did not measure that strategy, or a pair is not one', async () => {
      const path = reportPathIn((await drl('eval', '--strategy', 'vector')).out)
      const missing = await drl('eval', 'compare', path, path, '--strategies', 'hybrid,vector')
      expect(missing.code).toBe(1)
      expect(missing.err).toContain('did not measure hybrid')
      expect((await drl('eval', 'compare', path, path, '--strategies', 'hybrid')).err).toContain(
        '--strategies takes two strategies',
      )
      expect(
        (await drl('eval', 'compare', path, path, '--strategies', 'hybrid,bm25')).err,
      ).toContain('--strategies names vector, hybrid, rerank')
    })
  })

  it('reranks on request, in a development run too', async () => {
    rerankCalls = []
    rerankJitter = 0
    const { code, out } = await drl('eval', '--strategy', 'rerank', '--yes')
    expect(code).toBe(0)
    const path = reportPathIn(out)
    const report = readReport(path)
    expect(report.result.strategies.map(({ strategy }) => strategy)).toEqual(['rerank'])
    expect(report.identity.rerank).toEqual({
      model: settings.rerank.model,
      depth: settings.rerank.depth,
    })
    // One call per scored question.
    expect(rerankCalls).toHaveLength(2)
    expect(out).toContain('rerank: 2 calls, none retried after a 429')
    expect(report.run.rerank).toEqual({ calls: 2, rateLimitRetries: 0 })
    expect(readFileSync(path.replace(/\.json$/, '.md'), 'utf8')).toContain(
      'none retried after a 429',
    )
  })

  describe('a named run', () => {
    it('measures every strategy, and reproduces from the caches with no further call', async () => {
      rerankCalls = []
      rerankJitter = 0
      const { code, out } = await drl('eval', '--name', 'baseline', '--yes')
      expect(code).toBe(0)
      const path = reportPathIn(out)
      const report = readReport(path)
      expect(report.result.strategies.map(({ strategy }) => strategy)).toEqual([
        'vector',
        'hybrid',
        'rerank',
      ])
      expect(rerankCalls).toHaveLength(2)

      const verified = await drl('eval', 'verify', path)
      expect(verified.code).toBe(0)
      expect(verified.out).toContain('byte for byte')
      expect(rerankCalls).toHaveLength(2)
    })

    it('writes where git sees it, stamped with the date and commit', async () => {
      const sha = git('rev-parse', 'HEAD').slice(0, 8)

      const { code, out } = await drl('eval', '--name', 'baseline', '--yes')

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

      const { code, err } = await drl('eval', '--name', 'baseline', '--yes')

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

      const { code, err } = await drl('eval', '--name', 'baseline', '--yes')

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

      const { code, err } = await drl('eval', '--name', 'baseline', '--yes')

      expect(code).toBe(1)
      expect(err).toContain('a named run needs a clean golden check')
    })

    it('never overwrites a report', async () => {
      const path = reportPathIn((await drl('eval', '--name', 'baseline', '--yes')).out)
      const before = readFileSync(path, 'utf8')
      clock += 1000

      const { code, err } = await drl('eval', '--name', 'baseline', '--yes')

      expect(code).toBe(1)
      expect(err).toContain('already exists')
      expect(readFileSync(path, 'utf8')).toBe(before)
    })

    it('needs a clean golden check', async () => {
      rmSync(join(root, goldenLockRelative()))
      commitAll()

      const { code, err } = await drl('eval', '--name', 'baseline', '--yes')

      expect(code).toBe(1)
      expect(err).toContain('a named run needs a clean golden check')
    })

    it('takes lowercase words with hyphens as a name', async () => {
      const { code, err } = await drl('eval', '--name', 'Base Line')

      expect(code).toBe(1)
      expect(err).toContain('--name takes lowercase words with hyphens')
    })

    it.each(['pre-verify', 'calibration', 'old-calibration-fresh'])(
      'refuses %s, whose report would read as a file next to a report',
      async (name) => {
        const { code, err } = await drl('eval', '--name', name)

        expect(code).toBe(1)
        expect(err).toContain('would read as a calibration or verify file')
      },
    )
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

describe('drl eval answers', () => {
  beforeEach(() => {
    claudeRequests = []
    judgeBody = SOUND_JUDGE
  })

  const reportOf = (out: string): EvalReport => readReport(reportPathIn(out))
  const answersOf = (out: string) => {
    const { answers } = reportOf(out)
    if (answers === undefined) throw new Error('no answers')
    return answers
  }

  it('prints the estimate and spends nothing without --yes', async () => {
    const { code, out } = await drl('eval', 'answers')

    expect(code).toBe(0)
    expect(out).toContain('estimate, at list prices')
    expect(out).toContain('answers: 9 (0 cached)')
    expect(out).toContain('no paid call was made: add --yes')
    expect(claudeRequests).toEqual([])
    expect(reportFiles('dev')).toEqual([])
  })

  it('refuses an estimate over the limit, even with --yes', async () => {
    const { code, err } = await drl('eval', 'answers', '--yes', '--max-usd', '0.0001')

    expect(code).toBe(1)
    expect(err).toContain('the estimate is over the limit')
    expect(claudeRequests).toEqual([])
  })

  it('answers every row and judges each answer, with the judge model', async () => {
    const { code, out } = await drl('eval', 'answers', '--yes')

    expect(code).toBe(0)
    const answers = answersOf(out)
    expect(answers.rows.map(({ row }) => row)).toEqual([0, 2, 3])
    expect(answers.answers).toHaveLength(9)
    expect(answers.verdicts).toHaveLength(9)
    expect(answers.models).toEqual({
      answer: settings.models.answer,
      judge: settings.models.judge,
    })
    expect(answers.rows[2]?.overall.correctness).toBe(1.5)
    expect(answers.rows[2]?.refusals).toEqual({
      questions: 1,
      correct: 1,
      hallucinations: 0,
      wrong: 0,
    })
    const models = new Set(claudeRequests.map((request) => request.model))
    expect(models).toEqual(new Set([settings.models.answer, settings.models.judge]))
    expect(answers.paidUsd).toBeGreaterThan(0)
    expect(out).toContain('row 3: correctness 1.500 over 2')
  })

  it('compares row 2 with row 3 and row 0 with row 3', async () => {
    const { comparisons } = answersOf((await drl('eval', 'answers', '--yes')).out)

    expect(comparisons.map(({ a, b }) => [a, b])).toEqual([
      ['row 2', 'row 3'],
      ['row 0', 'row 3'],
    ])
  })

  it('a rerun answers from the cache, and pays nothing', async () => {
    await drl('eval', 'answers', '--yes')
    const paid = claudeRequests.length
    clock += 1000

    const { out } = await drl('eval', 'answers', '--yes')

    expect(claudeRequests).toHaveLength(paid)
    const answers = answersOf(out)
    expect(answers.paidUsd).toBe(0)
    expect(answers.answers.every(({ fromCache }) => fromCache)).toBe(true)
    expect(answers.rows[2]?.overall.meanCostUsd).toBeGreaterThan(0)
  })

  it('takes a pilot of some questions and rows', async () => {
    const { out } = await drl('eval', 'answers', '--yes', '--only', 'ts-0001', '--rows', '0,3')

    const answers = answersOf(out)
    expect(answers.answers.map(({ questionId, row }) => [questionId, row])).toEqual([
      ['ts-0001', 0],
      ['ts-0001', 3],
    ])
  })

  it('a noise run answers row 3 twice and asks the judge twice', async () => {
    const answers = answersOf((await drl('eval', 'answers', '--yes', '--noise')).out)

    expect(answers.rows.map(({ row, sample }) => [row, sample])).toEqual([
      [0, 1],
      [2, 1],
      [3, 1],
      [3, 2],
    ])
    expect(answers.comparisons.at(-1)).toMatchObject({ a: 'row 3', b: 'row 3 again' })
    expect(answers.judgeRetest).toEqual({ compared: 3, agreed: 3 })
  })

  it('says what is known about the judge wherever correctness is reported', async () => {
    const { out } = await drl('eval', 'answers', '--yes')

    expect(out).toContain('The judge is not calibrated for these prompts')
    const markdown = readFileSync(reportPathIn(out).replace(/\.json$/, '.md'), 'utf8')
    expect(markdown).toContain('The judge is not calibrated for these prompts')
  })

  it('carries the labels through to later reports: calibrated, with the bias', async () => {
    const path = reportPathIn((await drl('eval', 'answers', '--yes')).out)
    const report = readReport(path)
    const answers = report.answers?.answers ?? []
    const verdicts = report.answers?.verdicts ?? []
    const golden = parseGoldenSet(readFileSync(goldenSetPath(root, 'typescript'), 'utf8'))
    const sample = sampleForLabels({ rows: [0, 2, 3], answers, verdicts, questions: golden })
    const labels = sample.map((answer, i): Record<string, unknown> => {
      const verdict = verdicts.find(
        (item) => item.questionId === answer.questionId && item.row === answer.row,
      )
      return verdict?.outcome == null
        ? {
            item: i + 1,
            correctness: verdict?.correctness,
            ...(answer.claims.length > 0 ? { supported: true } : {}),
          }
        : { item: i + 1, outcome: verdict.outcome }
    })
    // One answer scored lower than the judge did, so the judge runs high on this one.
    const lowered = labels.find((line) => line.correctness === 2)
    if (lowered !== undefined) lowered.correctness = 1
    const labelsPath = join(root, 'labels.json')
    writeFileSync(labelsPath, JSON.stringify({ sample: sampleHash(sample), labels }))
    await drl('eval', 'calibrate', path, labelsPath)
    const stored = JSON.parse(
      readFileSync(path.replace(/\.json$/, '-calibration.json'), 'utf8'),
    ) as { prompts: Record<string, string>; correctnessDisagreements: unknown[] }
    expect(stored.prompts).toEqual(report.answers?.prompts)
    expect(stored.correctnessDisagreements).toHaveLength(1)
    // Named reports are what the store reads: copy this one's calibration beside the next run.
    writeFileSync(
      join(reportsDir(root, 'typescript'), '2026-11-03-abcdef12-x-calibration.json'),
      JSON.stringify(stored),
    )
    clock += 1000

    const { out } = await drl('eval', 'answers', '--yes')

    expect(out).toContain('correctness may be slightly inflated')
  })

  it('keeps the answers in the JSON, and out of the markdown', async () => {
    const path = reportPathIn((await drl('eval', 'answers', '--yes')).out)

    expect(readFileSync(path, 'utf8')).toContain('SECRET ANSWER TEXT.')
    const markdown = readFileSync(path.replace(/\.json$/, '.md'), 'utf8')
    expect(markdown).toContain('## Answers')
    expect(markdown).toContain('### row 2 against row 3')
    expect(markdown).not.toContain('SECRET')
  })

  describe('when calls fail', () => {
    beforeEach(() => {
      judgeBody = () => ({ nothing: true })
    })

    // Not all at once, or it stops as a broken key would.
    const everyOtherFails = () => {
      let calls = 0
      judgeBody = (system, text) =>
        ++calls % 2 === 0 ? { nothing: true } : SOUND_JUDGE(system, text)
    }

    it('writes what it has, says so, and exits non-zero', async () => {
      everyOtherFails()

      const { code, out, err } = await drl('eval', 'answers', '--yes')

      expect(code).toBe(1)
      expect(err).toContain('calls failed, so the report leaves those out')
      const markdown = readFileSync(reportPathIn(out).replace(/\.json$/, '.md'), 'utf8')
      expect(markdown).toContain('not judged:')
    })

    it('a rerun pays only for those', async () => {
      everyOtherFails()
      await drl('eval', 'answers', '--yes')
      const paid = claudeRequests.length
      judgeBody = SOUND_JUDGE
      clock += 1000

      const { code } = await drl('eval', 'answers', '--yes')

      expect(code).toBe(0)
      expect(claudeRequests.length).toBeGreaterThan(paid)
      expect(claudeRequests.length).toBeLessThan(paid * 2)
    })

    it('a named report refuses to exist with anything failed', async () => {
      everyOtherFails()

      const { code, err } = await drl('eval', 'answers', '--name', 'x', '--yes')

      expect(code).toBe(1)
      expect(err).toContain('a named report needs them all')
      expect(reportFiles()).toEqual([])
    })
  })

  describe('rows 4 and 5', () => {
    beforeEach(() => {
      rerankCalls = []
      rerankJitter = 0
    })

    it('makes no rerank call without --yes, and says how many it would', async () => {
      const { code, out } = await drl('eval', 'answers', '--rows', '4')

      expect(code).toBe(0)
      expect(out).toContain('this would first make 3 calls')
      expect(rerankCalls).toEqual([])
      expect(claudeRequests).toEqual([])
    })

    it('reranks every question, also those the docs do not answer, before the estimate', async () => {
      const refused = await drl('eval', 'answers', '--rows', '4', '--yes', '--max-usd', '0.0001')

      expect(refused.err).toContain('the estimate is over the limit')
      expect(rerankCalls).toHaveLength(3)
      expect(claudeRequests).toEqual([])

      const { out } = await drl('eval', 'answers', '--rows', '4')

      expect(out).toContain('answers: 3 (0 cached)')
      expect(rerankCalls).toHaveLength(3)
    })

    it('row 5 says which index it read, reranks the contexts, and sends Claude the text alone', async () => {
      seedIndex('contextual')

      const { code, out } = await drl('eval', 'answers', '--rows', '4,5', '--yes')

      expect(code).toBe(0)
      const answers = answersOf(out)
      expect(answers.contextualIndex).toMatchObject({
        rows: [5],
        contextModel: 'claude-test:abc',
      })
      expect(answers.rows.map(({ row }) => row)).toEqual([4, 5])
      expect(answers.comparisons.map(({ a, b }) => [a, b])).toEqual([['row 4', 'row 5']])
      expect(rerankCalls.flat().some((text) => text.startsWith('Context of '))).toBe(true)
      expect(JSON.stringify(claudeRequests)).not.toContain('Context of ')
      const markdown = readFileSync(reportPathIn(out).replace(/\.json$/, '.md'), 'utf8')
      expect(markdown).toContain('Row 5 read the contextual index')
    })

    it('says what to run when the contextual index is not built', async () => {
      const { code, err } = await drl('eval', 'answers', '--rows', '5')

      expect(code).toBe(1)
      expect(err).toContain('run drl sync typescript --contextual first')
      expect(rerankCalls).toEqual([])
    })

    it('a noise run answers rows 3, 4 and 5 twice, and asks the judge twice about row 3', async () => {
      seedIndex('contextual')

      const { out } = await drl('eval', 'answers', '--rows', '3,4,5', '--noise', '--yes')

      const answers = answersOf(out)
      expect(answers.rows.map(({ row, sample }) => [row, sample])).toEqual([
        [3, 1],
        [4, 1],
        [5, 1],
        [3, 2],
        [4, 2],
        [5, 2],
      ])
      expect(answers.comparisons.map(({ a, b }) => [a, b])).toEqual([
        ['row 3', 'row 4'],
        ['row 3', 'row 5'],
        ['row 4', 'row 5'],
        ['row 3', 'row 3 again'],
        ['row 4', 'row 4 again'],
        ['row 5', 'row 5 again'],
      ])
      expect(answers.judgeRetest).toEqual({ compared: 3, agreed: 3 })
    })

    it('a named run also says what row 4 retrieved', async () => {
      seedIndex('contextual')

      const { code, out } = await drl(
        'eval',
        'answers',
        '--name',
        'x',
        '--rows',
        '0,2,3,4,5',
        '--yes',
      )

      expect(code).toBe(0)
      const report = reportOf(out)
      expect(report.result.strategies.map(({ strategy }) => strategy)).toEqual([
        'vector',
        'hybrid',
        'rerank',
      ])
      expect(report.identity.rerank).toBeDefined()
      expect(report.answers?.rows.map(({ row }) => row)).toEqual([0, 2, 3, 4, 5])
    })

    it('a named run still needs rows 0, 2 and 3', async () => {
      const { code, err } = await drl('eval', 'answers', '--name', 'x', '--rows', '4,5', '--yes')

      expect(code).toBe(1)
      expect(err).toContain('a named run answers the whole set under every row')
      expect(rerankCalls).toEqual([])
    })
  })

  it('a named run needs the whole set and every row', async () => {
    const only = await drl('eval', 'answers', '--name', 'x', '--only', 'ts-0001', '--yes')
    const rows = await drl('eval', 'answers', '--name', 'x', '--rows', '3', '--yes')

    expect(only.err).toContain('a named run answers the whole set under every row')
    expect(rows.err).toContain('a named run answers the whole set under every row')
    expect(claudeRequests).toEqual([])
  })

  it('refuses a name that reads as a file next to a report, before paying for anything', async () => {
    const { code, err } = await drl('eval', 'answers', '--name', 'pre-verify', '--yes')

    expect(code).toBe(1)
    expect(err).toContain('would read as a calibration or verify file')
    expect(claudeRequests).toEqual([])
  })

  it('a named run needs a clean tree, before paying for anything', async () => {
    writeFileSync(join(root, 'stray.txt'), 'x')

    const { code, err } = await drl('eval', 'answers', '--name', 'x', '--yes')

    expect(code).toBe(1)
    expect(err).toContain('a named run needs a clean tree')
    expect(claudeRequests).toEqual([])
  })

  it.each([
    [['eval', 'answers', '--rows', '1'], '--rows takes 0, 2, 3, 4, 5'],
    [['eval', 'answers', '--only', 'ts-9999'], 'there is no scored question ts-9999'],
    [['eval', 'answers', '--max-usd', 'lots'], '--max-usd must be a number above 0'],
    [['eval', '--yes'], '--yes does not apply'],
    [['eval', '--noise'], '--noise does not apply'],
    [['eval', 'check', '--rows', '0'], '--rows does not apply'],
    [['eval', 'verify', 'x.json', '--only', 'a'], '--only does not apply'],
    [['eval', 'label', 'x.json', '--yes'], '--yes does not apply'],
  ])('refuses %j', async (argv, message) => {
    const { code, err } = await drl(...argv)

    expect(code).toBe(1)
    expect(err).toContain(message)
  })

  describe('labels', () => {
    const sheetOf = (out: string): string => /: (.+labels-.+\.md)/.exec(out)?.[1] ?? ''

    it('takes a round from the new rows alone, and reads its labels against it', async () => {
      seedIndex('contextual')
      const path = reportPathIn((await drl('eval', 'answers', '--rows', '4,5', '--yes')).out)
      const report = readReport(path)
      const answers = report.answers?.answers ?? []
      const verdicts = report.answers?.verdicts ?? []
      const golden = parseGoldenSet(readFileSync(goldenSetPath(root, 'typescript'), 'utf8'))
      const sample = newRowsSampleForLabels({
        rows: [4, 5],
        answers,
        verdicts,
        questions: golden,
      })

      const { code, out } = await drl('eval', 'label', path, '--rows', '4,5')

      expect(code).toBe(0)
      expect(sheetOf(out)).toMatch(/-new-rows\.md$/)
      expect(out).toContain(`${String(sample.length)} answers to label`)
      const labels = sample.map((answer, i) => {
        const verdict = verdicts.find(
          (item) => item.questionId === answer.questionId && item.row === answer.row,
        )
        return verdict?.outcome == null
          ? { item: i + 1, correctness: verdict?.correctness, supported: true }
          : { item: i + 1, outcome: verdict.outcome }
      })
      const labelsPath = join(root, 'labels.json')
      writeFileSync(labelsPath, JSON.stringify({ sample: sampleHash(sample), labels }))

      const wrong = await drl('eval', 'calibrate', path, labelsPath)
      expect(wrong.err).toContain('these labels are of sample')

      const right = await drl('eval', 'calibrate', path, labelsPath, '--rows', '4,5')
      expect(right.code).toBe(0)
      const written = JSON.parse(
        readFileSync(path.replace(/\.json$/, '-calibration.json'), 'utf8'),
      ) as { labelled: number; agreement: { dimension: string }[] }
      expect(written.labelled).toBe(sample.length)
      expect(written.agreement.map(({ dimension }) => dimension)).toEqual([
        'correctness',
        'refusal',
        'support',
      ])

      const both = await drl('eval', 'label', path, '--rows', '4,5', '--after', path)
      expect(both.err).toContain('--after and --rows cannot go together')
    })

    it('writes a sheet with the answers and no verdict, under dev/', async () => {
      judgeBody = (system, text) => {
        const body = SOUND_JUDGE(system, text) as Record<string, unknown>
        return 'reasoning' in body ? { ...body, reasoning: 'THE JUDGE SAYS' } : body
      }
      const path = reportPathIn((await drl('eval', 'answers', '--yes')).out)

      const { code, out } = await drl('eval', 'label', path)

      expect(code).toBe(0)
      const sheet = sheetOf(out)
      expect(sheet).toMatch(/[\\/]dev[\\/]labels-/)
      const text = readFileSync(sheet, 'utf8')
      expect(text).toMatch(/Sample `[0-9a-f]{12}`/)
      expect(text).toContain('SECRET ANSWER TEXT.')
      expect(text).toContain('SECRET PASSAGE.')
      expect(text).toContain('## Item 1')
      expect(text).not.toContain('THE JUDGE SAYS')
      expect(text).not.toMatch(/row \d|hybrid|vector/i)
    })

    it('says how often a human agrees with the judge, per dimension', async () => {
      const path = reportPathIn((await drl('eval', 'answers', '--yes')).out)
      const report = readReport(path)
      const answers = report.answers?.answers ?? []
      const verdicts = report.answers?.verdicts ?? []
      const golden = parseGoldenSet(readFileSync(goldenSetPath(root, 'typescript'), 'utf8'))
      // The sample the sheet shows: the same seed gives the same items.
      const sample = sampleForLabels({ rows: [0, 2, 3], answers, verdicts, questions: golden })
      const labels = sample.map((answer, i) => {
        const verdict = verdicts.find(
          (item) => item.questionId === answer.questionId && item.row === answer.row,
        )
        return verdict?.outcome == null
          ? {
              item: i + 1,
              correctness: verdict?.correctness,
              ...(answer.claims.length > 0 ? { supported: true } : {}),
            }
          : { item: i + 1, outcome: verdict.outcome }
      })
      const labelsPath = join(root, 'labels.json')
      writeFileSync(labelsPath, JSON.stringify({ sample: sampleHash(sample), labels }))

      const { code, out } = await drl('eval', 'calibrate', path, labelsPath)

      expect(code).toBe(0)
      expect(out).toContain('This round reached the bar on what it measured.')
      expect(out).toContain('This is a development report, so these labels count for no report')
      expect(out).not.toContain('The judge is calibrated')
      const written = path.replace(/\.json$/, '-calibration')
      expect(JSON.parse(readFileSync(`${written}.json`, 'utf8'))).toMatchObject({
        labelled: sample.length,
        calibrated: true,
      })
      expect(readFileSync(`${written}.md`, 'utf8')).toContain('| correctness |')
    })

    it('writes what a named report says of its judge again, once labels exist', async () => {
      const path = reportPathIn((await drl('eval', 'answers', '--name', 'x', '--yes')).out)
      const markdown = path.replace(/\.json$/, '.md')
      const stored = readFileSync(path, 'utf8')
      expect(readFileSync(markdown, 'utf8')).toContain('The judge is not calibrated')
      const report = readReport(path)
      const answers = report.answers?.answers ?? []
      const verdicts = report.answers?.verdicts ?? []
      const golden = parseGoldenSet(readFileSync(goldenSetPath(root, 'typescript'), 'utf8'))
      const sample = sampleForLabels({ rows: [0, 2, 3], answers, verdicts, questions: golden })
      const labels = sample.map((answer, i) => {
        const verdict = verdicts.find(
          (item) => item.questionId === answer.questionId && item.row === answer.row,
        )
        return verdict?.outcome == null
          ? {
              item: i + 1,
              correctness: verdict?.correctness,
              ...(answer.claims.length > 0 ? { supported: true } : {}),
            }
          : { item: i + 1, outcome: verdict.outcome }
      })
      const labelsPath = join(root, 'labels.json')
      writeFileSync(labelsPath, JSON.stringify({ sample: sampleHash(sample), labels }))

      const calibrated = await drl('eval', 'calibrate', path, labelsPath)

      expect(calibrated.code).toBe(0)
      expect(calibrated.out).toContain('The judge is calibrated for these prompts.')
      const text = readFileSync(markdown, 'utf8')
      expect(text).toContain('The judge is calibrated for these prompts.')
      expect(text).not.toContain('The judge is not calibrated')
      expect(readFileSync(path, 'utf8')).toBe(stored)
      expect(
        JSON.parse(readFileSync(path.replace(/\.json$/, '-calibration.json'), 'utf8')),
      ).toMatchObject({ judgeModel: report.answers?.models.judge })
    })

    /** Labels of the whole sample, each with every field a kind of question can need. */
    function allItems(path: string, line: Record<string, unknown>) {
      const report = readReport(path)
      const golden = parseGoldenSet(readFileSync(goldenSetPath(root, 'typescript'), 'utf8'))
      const sample = sampleForLabels({
        rows: [0, 2, 3],
        answers: report.answers?.answers ?? [],
        verdicts: report.answers?.verdicts ?? [],
        questions: golden,
      })
      return {
        sample: sampleHash(sample),
        labels: sample.map((_, i) => ({ item: i + 1, ...line })),
      }
    }

    it('marks the answer metrics uncalibrated when the labels disagree', async () => {
      const path = reportPathIn((await drl('eval', 'answers', '--yes')).out)
      const labelsPath = join(root, 'labels.json')
      writeFileSync(
        labelsPath,
        JSON.stringify(allItems(path, { correctness: 0, outcome: 'wrong', supported: false })),
      )

      const { out } = await drl('eval', 'calibrate', path, labelsPath)

      expect(out).toContain('uncalibrated')
    })

    it('refuses labels of another sample, since they would pair with the wrong answers', async () => {
      const path = reportPathIn((await drl('eval', 'answers', '--yes')).out)
      const labelsPath = join(root, 'labels.json')
      const file = allItems(path, { correctness: 2, outcome: 'wrong' })
      writeFileSync(labelsPath, JSON.stringify({ ...file, sample: 'other' }))

      const { code, err } = await drl('eval', 'calibrate', path, labelsPath)

      expect(code).toBe(1)
      expect(err).toContain('they would be read against other answers')
    })

    it('needs every item once, so that a few labels cannot calibrate anything', async () => {
      const path = reportPathIn((await drl('eval', 'answers', '--yes')).out)
      const labelsPath = join(root, 'labels.json')
      const file = allItems(path, { correctness: 2, outcome: 'wrong' })

      writeFileSync(labelsPath, JSON.stringify({ ...file, labels: file.labels.slice(1) }))
      expect((await drl('eval', 'calibrate', path, labelsPath)).err).toContain('1 missing')

      const repeated = [...file.labels, file.labels[0]]
      writeFileSync(labelsPath, JSON.stringify({ ...file, labels: repeated }))
      expect((await drl('eval', 'calibrate', path, labelsPath)).err).toContain('appears twice')

      const beyond = [...file.labels.slice(1), { item: 99, correctness: 2 }]
      writeFileSync(labelsPath, JSON.stringify({ ...file, labels: beyond }))
      expect((await drl('eval', 'calibrate', path, labelsPath)).code).toBe(1)
    })

    it('compares refusals over every answer, and a refused answerable question counts', async () => {
      const path = reportPathIn((await drl('eval', 'answers', '--yes')).out)
      const labelsPath = join(root, 'labels.json')
      const file = allItems(path, { correctness: 2, outcome: 'correct-refusal' })
      writeFileSync(labelsPath, JSON.stringify(file))

      const agreed = await drl('eval', 'calibrate', path, labelsPath)

      expect(agreed.out).toContain(`| refusal | ${String(file.labels.length)} | `)
      expect(agreed.out).toContain('agree on 3 of 3')

      // A human who says one answerable answer refused, where the judge says it did not.
      const report = readReport(path)
      const golden = parseGoldenSet(readFileSync(goldenSetPath(root, 'typescript'), 'utf8'))
      const sample = sampleForLabels({
        rows: [0, 2, 3],
        answers: report.answers?.answers ?? [],
        verdicts: report.answers?.verdicts ?? [],
        questions: golden,
      })
      const item = sample.findIndex(({ questionId }) => questionId === 'ts-0001') + 1
      writeFileSync(
        labelsPath,
        JSON.stringify({
          ...file,
          labels: file.labels.map((line) =>
            line.item === item ? { ...line, correctness: 0, refused: true } : line,
          ),
        }),
      )

      const { out } = await drl('eval', 'calibrate', path, labelsPath)

      expect(out).toContain(
        `| refusal | ${String(file.labels.length - 1)} | ${String(file.labels.length)} | `,
      )
    })

    it.each([
      ['a refusal that scored', 'ts-0001', 'is refused, and a refusal scores 0'],
      ['refused on a question with an outcome', 'ts-0003', 'takes an outcome, not refused'],
    ])('refuses %s', async (_name, questionId, message) => {
      const path = reportPathIn((await drl('eval', 'answers', '--yes')).out)
      const labelsPath = join(root, 'labels.json')
      const file = allItems(path, { correctness: 2, outcome: 'wrong' })
      const report = readReport(path)
      const sample = sampleForLabels({
        rows: [0, 2, 3],
        answers: report.answers?.answers ?? [],
        verdicts: report.answers?.verdicts ?? [],
        questions: parseGoldenSet(readFileSync(goldenSetPath(root, 'typescript'), 'utf8')),
      })
      const item = sample.findIndex((answer) => answer.questionId === questionId) + 1
      writeFileSync(
        labelsPath,
        JSON.stringify({
          ...file,
          labels: file.labels.map((line) =>
            line.item === item ? { ...line, refused: true } : line,
          ),
        }),
      )

      const { code, err } = await drl('eval', 'calibrate', path, labelsPath)

      expect(code).toBe(1)
      expect(err).toContain(message)
    })

    it('needs the label a kind of question asks for', async () => {
      const path = reportPathIn((await drl('eval', 'answers', '--yes')).out)
      const labelsPath = join(root, 'labels.json')
      writeFileSync(labelsPath, JSON.stringify(allItems(path, {})))

      expect((await drl('eval', 'calibrate', path, labelsPath)).err).toMatch(
        /item \d+ needs an? (outcome|correctness)/,
      )
    })

    describe('a second round', () => {
      /** Ten more questions, so that a fresh round has somewhere to go. */
      function moreQuestions(): void {
        const rows = Array.from({ length: 24 }, (_, i) => ({
          id: `ts-${String(i + 1).padStart(4, '0')}`,
          question: QUESTIONS[0],
          answer: `Answer ${String(i)}.`,
          primary: ['docs/a.md#one'],
          tags: ['basic'],
        }))
        writeFileSync(
          goldenSetPath(root, 'typescript'),
          `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`,
        )
      }

      async function twoReports() {
        moreQuestions()
        await drl('eval', 'check', '--accept', '--set-version', '2')
        const first = reportPathIn((await drl('eval', 'answers', '--yes')).out)
        clock += 1000
        const second = reportPathIn((await drl('eval', 'answers', '--yes')).out)
        return { first, second }
      }

      const golden = () => parseGoldenSet(readFileSync(goldenSetPath(root, 'typescript'), 'utf8'))

      function samples(first: string, second: string) {
        const a = readReport(first).answers
        const b = readReport(second).answers
        const firstSample = sampleForLabels({
          rows: [0, 2, 3],
          answers: a?.answers ?? [],
          verdicts: a?.verdicts ?? [],
          questions: golden(),
        })
        const freshSample = freshSampleForLabels({
          rows: [0, 2, 3],
          answers: b?.answers ?? [],
          verdicts: b?.verdicts ?? [],
          questions: golden(),
          exclude: firstSample,
        })
        return { firstSample, freshSample }
      }

      it('writes a fresh sheet of 10, apart from the first, with no citations', async () => {
        const { first, second } = await twoReports()

        const { code, out } = await drl('eval', 'label', second, '--after', first)

        expect(code).toBe(0)
        expect(out).toContain('10 answers to label')
        const sheet = sheetOf(out)
        expect(sheet).toMatch(/-fresh\.md$/)
        const text = readFileSync(sheet, 'utf8')
        expect(text).toContain('a fresh round')
        expect(text).not.toContain('SECRET PASSAGE')
      })

      it('holds a fresh round to at most 1 disagreement, on correctness alone', async () => {
        const { first, second } = await twoReports()
        const { freshSample } = samples(first, second)
        const labelsPath = join(root, 'fresh.json')
        const write = (wrong: number) => {
          writeFileSync(
            labelsPath,
            JSON.stringify({
              sample: sampleHash(freshSample),
              labels: freshSample.map((_, i) => ({ item: i + 1, correctness: i < wrong ? 0 : 2 })),
            }),
          )
        }

        write(1)
        const passed = await drl('eval', 'calibrate', second, labelsPath, '--after', first)
        expect(passed.out).toContain('| correctness | 9 | 10 |')
        expect(passed.out).toContain('This round reached the bar on what it measured.')
        expect(passed.out).not.toContain('| refusal |')
        expect(existsSync(second.replace(/\.json$/, '-calibration-fresh.md'))).toBe(true)

        write(2)
        const failed = await drl('eval', 'calibrate', second, labelsPath, '--after', first)
        expect(failed.out).toContain('| correctness | 8 | 10 |')
        expect(failed.out).toContain('uncalibrated')
      })

      it('reads the first labels against the new verdicts, marked as not blind', async () => {
        const { first, second } = await twoReports()
        const { firstSample } = samples(first, second)
        // Graded again, the low scores differ, and so would a sample taken from this report.
        const regraded = readReport(second)
        const keyOf = (item: { questionId: string; row: number }) =>
          `${item.questionId}/${String(item.row)}`
        const picked = new Set(firstSample.map(keyOf))
        for (const verdict of regraded.answers?.verdicts ?? []) {
          if (verdict.correctness !== null && !picked.has(keyOf(verdict))) verdict.correctness = 0
        }
        writeFileSync(second, JSON.stringify(regraded))
        const labelsPath = join(root, 'first.json')
        writeFileSync(
          labelsPath,
          JSON.stringify({
            sample: sampleHash(firstSample),
            labels: firstSample.map((_, i) => ({ item: i + 1, correctness: 2 })),
          }),
        )

        const { code, out } = await drl(
          'eval',
          'calibrate',
          second,
          labelsPath,
          '--sample-of',
          first,
        )

        expect(code).toBe(0)
        expect(out).toContain('**Not blind.**')
        expect(out).not.toContain('The judge is calibrated')
        expect(existsSync(second.replace(/\.json$/, '-calibration-not-blind.md'))).toBe(true)
      })

      it('refuses both flags at once', async () => {
        const { first, second } = await twoReports()

        const { code, err } = await drl(
          'eval',
          'calibrate',
          second,
          'x.json',
          '--after',
          first,
          '--sample-of',
          first,
        )

        expect(code).toBe(1)
        expect(err).toContain('cannot go together')
      })

      it.each([
        [['eval', 'answers', '--after', 'x'], '--after does not apply'],
        [['eval', '--record'], '--record does not apply'],
        [['eval', 'check', '--record'], '--record does not apply'],
        [['eval', 'check', '--after', 'x'], '--after does not apply'],
        [['eval', 'label', 'x.json', '--sample-of', 'y'], '--sample-of does not apply'],
      ])('refuses %j', async (argv, message) => {
        expect((await drl(...argv)).err).toContain(message)
      })
    })

    it('needs a report with answers', async () => {
      const path = reportPathIn((await drl('eval')).out)

      expect((await drl('eval', 'label', path)).err).toContain('has no answers')
    })
  })

  describe('judge-check', () => {
    it('says what it would do without --yes, and spends nothing', async () => {
      writeThreeQuestions()
      await drl('eval', 'check', '--accept', '--set-version', '2')

      const { code, out } = await drl('eval', 'judge-check')

      expect(code).toBe(0)
      expect(out).toContain('add --yes')
      expect(claudeRequests).toEqual([])
    })

    it('fails when the judge gets a known case wrong', async () => {
      writeThreeQuestions()
      await drl('eval', 'check', '--accept', '--set-version', '2')

      const { code, out, err } = await drl('eval', 'judge-check', '--yes')

      expect(code).toBe(1)
      expect(out).toContain('WRONG')
      expect(err).toContain('the judge cannot be trusted')
    })
  })
})

function writeThreeQuestions(): void {
  const rows = [1, 2, 3].map((i) => ({
    id: `ts-000${String(i)}`,
    question: `Question ${String(i)}?`,
    answer: 'A.',
    primary: ['docs/a.md#one'],
    tags: ['basic'],
  }))
  writeFileSync(
    goldenSetPath(root, 'typescript'),
    `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`,
  )
}

describe('drl eval verify', () => {
  it('says a report reproduces byte for byte, at the same commit', async () => {
    const path = reportPathIn((await drl('eval', '--name', 'baseline', '--yes')).out)

    const { code, out } = await drl('eval', 'verify', path)

    expect(code).toBe(0)
    expect(out).toContain('re-run at')
    expect(out).toContain(
      'reproduced: what was measured matches the report byte for byte, on the same vectors',
    )
    expect(out).toContain('with uncommitted changes')
  })

  it('records what it found next to the report, with --record, for the dashboard', async () => {
    const path = reportPathIn((await drl('eval')).out)

    const { code, out } = await drl('eval', 'verify', path, '--record')

    expect(code).toBe(0)
    const recordPath = path.replace(/\.json$/, '-verify.json')
    expect(out).toContain(`recorded: ${recordPath}`)
    expect(JSON.parse(readFileSync(recordPath, 'utf8'))).toEqual({
      status: 'identical',
      changedVectors: [],
      rerun: {
        repoSha: git('rev-parse', 'HEAD'),
        repoDirty: false,
        at: new Date(clock).toISOString(),
      },
    })
  })

  it('records nothing without --record, and records a failure too', async () => {
    const path = reportPathIn((await drl('eval')).out)
    const recordPath = path.replace(/\.json$/, '-verify.json')

    await drl('eval', 'verify', path)
    expect(existsSync(recordPath)).toBe(false)

    const report = readReport(path)
    report.identity.docs.sha = 'a'.repeat(40)
    writeFileSync(path, JSON.stringify(report))

    const { code } = await drl('eval', 'verify', path, '--record')

    expect(code).toBe(1)
    expect(JSON.parse(readFileSync(recordPath, 'utf8'))).toMatchObject({ status: 'not-comparable' })
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
    expect(err).toContain('says nothing about the report')
    expect(err).not.toContain('did not reproduce')
  })

  it('does not call another measurement a failed reproduction, at the same docs too', async () => {
    const path = reportPathIn((await drl('eval')).out)
    const report = readReport(path)
    report.identity.retrievalVersion += 1
    writeFileSync(path, JSON.stringify(report))

    const { code, err } = await drl('eval', 'verify', path)

    expect(code).toBe(1)
    expect(err).toContain('says nothing about the report')
    expect(err).not.toContain('did not reproduce')
    expect(err).not.toContain('drl sync')
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

  it('does not send a run to a commit that cannot settle it, when the report was dirty', async () => {
    const path = reportPathIn((await drl('eval')).out)
    const report = readReport(path)
    withDeepAnchor(report)
    report.run.repoDirty = true
    writeFileSync(path, JSON.stringify(report))

    const { code, out, err } = await drl('eval', 'verify', path)

    expect(code).toBe(1)
    expect(out).toContain('inconclusive')
    expect(err).toContain('no commit can tell code from vectors')
    expect(err).not.toContain('run this at')
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

  it('tells apart two reports with one name at one commit', async () => {
    const { a, b } = await twoRuns()
    for (const path of [a, b]) {
      const report = readReport(path)
      report.run.name = 'baseline'
      writeFileSync(path, JSON.stringify(report))
    }
    const sha = readReport(a).run.repoSha.slice(0, 8)

    const { out } = await drl('eval', 'compare', a, b)

    expect(out).toContain(`baseline@${sha} (1)`)
    expect(out).toContain(`baseline@${sha} (2)`)
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
