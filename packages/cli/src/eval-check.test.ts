// `drl eval check` and the report after `drl sync`, over a seeded index in the OS
// temp dir and a local git repository. No network and no API key is used.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { CHUNKER_VERSION, createEmbeddingProvider, openIndexes } from '@docs-rag-lab/core'
import { settings } from '@docs-rag-lab/settings'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { goldenLockPath, goldenSetPath } from './golden.ts'
import { run, sourcesFor } from './run.ts'

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

async function drl(...argv: string[]) {
  const out = capture()
  const err = capture()
  const code = await run(argv, { out: out.writer, err: err.writer, root, debug: false })
  return { code, out: out.text(), err: err.text() }
}

/** Seeds data/ with one document, `docs/a.md`, whose chunk holds the section `sec`. */
function seedIndex(text: string, chunkerVersion = CHUNKER_VERSION, anchors = ['sec']): void {
  const { dimensions } = settings.embeddings
  const indexes = openIndexes(join(root, settings.dataDir), 'typescript')
  indexes.index.applyChanges({
    documents: [
      {
        path: 'docs/a.md',
        url: 'https://x.dev/a',
        title: 'A',
        docType: 'handbook',
        contentHash: text,
        lastChangedSha: 's',
        chunks: [
          {
            id: 'c1',
            ordinal: 0,
            headingPath: ['Sec'],
            anchor: anchors[0] ?? '',
            blockTypes: ['prose'],
            text,
            metadata: { anchors },
            tokenCount: 5,
            textHash: text,
            vector: Float32Array.from({ length: dimensions }, (_, i) => (i === 0 ? 1 : 0)),
          },
        ],
      },
    ],
    deletePaths: [],
    manifest: {
      sourceId: 'typescript',
      repo: 'r',
      branch: 'v2',
      includePaths: [],
      commitSha: '205122bb73dcbf6f3b373de5bdb0d9fa5434d015',
      syncedAt: '2026-11-02T00:00:00.000Z',
      embedModel: createEmbeddingProvider(settings.embeddings).id,
      embedDimensions: dimensions,
      contextModel: null,
      chunkerVersion,
      parserVersion: 1,
    },
  })
  indexes.close()
}

function writeGoldenSet(...rows: unknown[]): void {
  const path = goldenSetPath(root, 'typescript')
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, rows.map((row) => JSON.stringify(row)).join('\n') + '\n')
}

const answerable = {
  id: 'ts-0001',
  question: 'Q?',
  answer: 'A.',
  primary: ['docs/a.md#sec'],
  tags: ['basic'],
}
const unanswerable = {
  id: 'ts-0002',
  question: 'R?',
  answer: 'The docs do not cover this.',
  tags: ['unanswerable'],
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'drl-eval-'))
  writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages: []\n')
  // A placeholder: neither path below sends a request, and the provider's constructor needs one.
  vi.stubEnv('VOYAGE_API_KEY', 'pa-test')
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(root, { recursive: true, force: true })
})

describe('drl eval check', () => {
  it('asks for a review before there is a lock, then passes once it is accepted', async () => {
    seedIndex('A > Sec\n\nThe text.')
    writeGoldenSet(answerable, unanswerable)

    const first = await drl('eval', 'check')

    expect(first.code).toBe(1)
    expect(first.out).toContain(
      'golden set: 2 questions (1 unanswerable), 1 anchors, docs 205122bb',
    )
    expect(first.out).toContain('to review: ts-0001')
    expect(first.out).toContain('  ts-0001 primary docs/a.md#sec: not in the lock')
    expect(first.err).toContain('--accept')
    expect(existsSync(goldenLockPath(root, 'typescript'))).toBe(false)

    const accepted = await drl('eval', 'check', '--accept')

    expect(accepted.code).toBe(0)
    expect(accepted.out).toContain('the lock now records 1 anchors at 205122bb')
    expect(JSON.parse(readFileSync(goldenLockPath(root, 'typescript'), 'utf8'))).toEqual({
      docsSha: '205122bb73dcbf6f3b373de5bdb0d9fa5434d015',
      anchors: { 'docs/a.md#sec': [{ chunkId: 'c1', textHash: 'A > Sec\n\nThe text.' }] },
    })

    const second = await drl('eval', 'check')

    expect(second.code).toBe(0)
    expect(second.out).toContain('every anchor resolves and matches the lock')
    expect(second.out).toContain('usage: no API calls')
  })

  it('names a question whose text changed under its anchor, and fails', async () => {
    seedIndex('A > Sec\n\nOld text.')
    writeGoldenSet(answerable)
    await drl('eval', 'check', '--accept')
    seedIndex('A > Sec\n\nNew text.')

    const { code, out } = await drl('eval', 'check')

    expect(code).toBe(1)
    expect(out).toContain('to review: ts-0001')
    expect(out).toContain('the text changed since the lock')
  })

  it('names a question whose anchor is gone, and will not accept it', async () => {
    seedIndex('A > Sec\n\nThe text.')
    writeGoldenSet(answerable)
    await drl('eval', 'check', '--accept')
    const lock = readFileSync(goldenLockPath(root, 'typescript'), 'utf8')
    seedIndex('A > Sec\n\nThe text.', CHUNKER_VERSION, ['other'])

    const { code, out } = await drl('eval', 'check')

    expect(code).toBe(1)
    expect(out).toContain('stale, left out of metrics: ts-0001')
    expect(out).toContain('  ts-0001 primary docs/a.md#sec: no such section')

    const accepted = await drl('eval', 'check', '--accept')

    expect(accepted.code).toBe(1)
    expect(accepted.err).toContain('stale questions cannot be accepted')
    expect(readFileSync(goldenLockPath(root, 'typescript'), 'utf8')).toBe(lock)
  })

  it('lists the problems of a malformed golden set, without a stack trace hint', async () => {
    seedIndex('A > Sec\n\nThe text.')
    writeGoldenSet({ ...answerable, tags: ['basics'] })

    const { code, err } = await drl('eval', 'check')

    expect(code).toBe(1)
    expect(err).toContain('line 1: unknown tag "basics"')
    expect(err).not.toContain('DRL_DEBUG')
  })

  it('says to sync when the index was built by another chunker', async () => {
    seedIndex('A > Sec\n\nThe text.', CHUNKER_VERSION - 1)
    writeGoldenSet(answerable)

    const { code, err } = await drl('eval', 'check')

    expect(code).toBe(1)
    expect(err).toContain(`chunker version ${String(CHUNKER_VERSION - 1)}`)
    expect(err).toContain('run drl sync typescript')
  })

  it('says so when the source has no golden set, and when there is no index', async () => {
    const noIndex = await drl('eval', 'check')
    expect(noIndex.code).toBe(1)
    expect(noIndex.err).toContain('there is no index for typescript yet')

    seedIndex('A > Sec\n\nThe text.')
    const noSet = await drl('eval', 'check')
    expect(noSet.code).toBe(1)
    expect(noSet.err).toContain('typescript has no golden set')
  })

  it('asks for a subcommand, and takes --accept only there', async () => {
    const bare = await drl('eval')
    expect(bare.code).toBe(1)
    expect(bare.err).toContain('eval needs a subcommand: drl eval check')

    const misplaced = await drl('search', 'q', '--accept')
    expect(misplaced.code).toBe(2)
    expect(misplaced.err).toContain('--accept works only with eval check')
  })
})

describe('drl sync', () => {
  // A repository with no matching files: a real sync that embeds nothing.
  async function syncEmptyRepo() {
    const upstream = join(root, 'upstream')
    const gitConfig = join(root, 'gitconfig')
    writeFileSync(gitConfig, '[user]\n\tname = Test\n\temail = test@example.com\n')
    vi.stubEnv('GIT_CONFIG_GLOBAL', gitConfig)
    vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1')
    mkdirSync(upstream)
    const git = (...args: string[]) => execFileSync('git', args, { cwd: upstream, stdio: 'pipe' })
    git('init', '--quiet', '-b', 'v2')
    git('config', 'uploadpack.allowFilter', 'true')
    git('commit', '--quiet', '--allow-empty', '-m', 'initial')
    const [typescript] = sourcesFor(settings)
    if (typescript === undefined) throw new Error('no source')
    const source = { ...typescript, repo: pathToFileURL(upstream).href, include: ['docs'] }

    const out = capture()
    const err = capture()
    const code = await run(['sync', 'typescript'], {
      out: out.writer,
      err: err.writer,
      root,
      sources: [source],
      debug: false,
    })
    return { code, out: out.text(), err: err.text() }
  }

  it(
    'says which golden questions it made stale, and still succeeds',
    { timeout: 30_000 },
    async () => {
      writeGoldenSet(answerable)

      const { code, out } = await syncEmptyRepo()

      expect(code).toBe(0)
      expect(out).toContain('stale, left out of metrics: ts-0001')
      expect(out).toContain('  ts-0001 primary docs/a.md#sec: no such document')
    },
  )

  it('reports a broken golden set without failing', { timeout: 30_000 }, async () => {
    writeGoldenSet({ ...answerable, tags: [] })

    const { code, out } = await syncEmptyRepo()

    expect(code).toBe(0)
    expect(out).toContain('line 1: "tags" must be a non-empty array')
  })

  it('says nothing about a golden set when the source has none', { timeout: 30_000 }, async () => {
    const { code, out } = await syncEmptyRepo()

    expect(code).toBe(0)
    expect(out).not.toContain('golden set')
  })
})
