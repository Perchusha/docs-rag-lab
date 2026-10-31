// M1 acceptance: incremental sync re-embeds only changed chunks (SPEC section
// 13). Runs against a local git repository in the OS temp dir, a fake source
// and a provider that records every text it embeds. No network.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { git, type Source } from '@docs-rag-lab/source-kit'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { openIndexes, sourceIndexPath, type OpenIndexes } from './indexes.ts'
import { syncSource, type SyncReport } from './ingest.ts'
import { demoSource, fakeVector, paragraph, RecordingProvider } from './test-helpers.ts'
import { UsageMeter } from './usage.ts'

let root: string
let upstream: string
let dataDir: string
let checkoutDir: string
let source: Source
let open: OpenIndexes | undefined

function write(path: string, content: string): void {
  const file = join(upstream, path)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, content)
}

async function commit(message: string): Promise<string> {
  await git(['add', '-A'], { cwd: upstream })
  await git(['commit', '--quiet', '-m', message], { cwd: upstream })
  return (await git(['rev-parse', 'HEAD'], { cwd: upstream })).trim()
}

function indexes(): OpenIndexes {
  open ??= openIndexes(dataDir, source.id)
  return open
}

function closeIndexes(): void {
  open?.close()
  open = undefined
}

async function sync(provider: RecordingProvider, full = false): Promise<SyncReport> {
  const { index, cache } = indexes()
  return syncSource({ source, provider, index, cache, checkoutDir, meter: new UsageMeter(), full })
}

// Doc A has two sections of about 500 tokens each, so they become two chunks.
const docA = (second: string) =>
  `# Doc A\n\n## First\n\n${paragraph(500, 'alpha')}\n\n## Second\n\n${paragraph(500, second)}\n`
const docB = `# Doc B\n\n## Only\n\n${paragraph(200, 'bravo')}\n`
const docC = `# Doc C\n\n## New\n\n${paragraph(200, 'charlie')}\n`

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'drl-ingest-'))
  upstream = join(root, 'upstream')
  dataDir = join(root, 'data')
  checkoutDir = join(root, 'cache', 'sources', 'demo')
  const globalConfig = join(root, 'gitconfig')
  writeFileSync(globalConfig, '[user]\n\tname = Test\n\temail = test@example.com\n')
  vi.stubEnv('GIT_CONFIG_GLOBAL', globalConfig)
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1')
  mkdirSync(upstream)
  await git(['init', '--quiet', '-b', 'main'], { cwd: upstream })
  await git(['config', 'uploadpack.allowFilter', 'true'], { cwd: upstream })
  await git(['config', 'uploadpack.allowAnySHA1InWant', 'true'], { cwd: upstream })
  source = demoSource(pathToFileURL(upstream).href)
  write('docs/a.md', docA('delta'))
  write('docs/b.md', docB)
})

afterEach(() => {
  closeIndexes()
  vi.unstubAllEnvs()
  rmSync(root, { recursive: true, force: true })
})

describe('syncSource', { timeout: 60_000 }, () => {
  it('re-embeds only new and changed chunks on an incremental sync', async () => {
    const provider = new RecordingProvider()
    await commit('initial')

    // 1. The first sync embeds every chunk.
    const first = await sync(provider)
    expect(first).toMatchObject({
      mode: 'full',
      reason: 'no previous sync',
      documents: { added: 2, modified: 0, unchanged: 0, deleted: 0 },
      chunks: { added: 3, changed: 0, unchanged: 0, deleted: 0 },
      vectors: { needed: 3, embedded: 3, cached: 0 },
    })
    expect(provider.embedded).toHaveLength(3)
    const { index } = indexes()
    const aBefore = index.chunkHashes('docs/a.md')
    expect(aBefore.size).toBe(2)

    // 2. Edit one section of A, add C, delete B.
    write('docs/a.md', docA('echo'))
    write('docs/c.md', docC)
    rmSync(join(upstream, 'docs/b.md'))
    const head = await commit('edit A, add C, delete B')
    provider.calls.length = 0

    const second = await sync(provider)

    expect(second).toMatchObject({
      mode: 'incremental',
      reason: undefined,
      previousSha: first.headSha,
      headSha: head,
      documents: { added: 1, modified: 1, unchanged: 0, deleted: 1 },
      chunks: { added: 1, changed: 1, unchanged: 1, deleted: 1 },
      vectors: { needed: 2, embedded: 2, cached: 0 },
    })
    // Exactly A's changed chunk and C's chunk went to the provider.
    expect(provider.embedded).toHaveLength(2)
    expect(provider.embedded[0]).toContain('echo')
    expect(provider.embedded[0]).not.toContain('alpha')
    expect(provider.embedded[1]).toContain('charlie')

    // A's unchanged chunk kept its ID and hash; its changed chunk kept its ID.
    const aAfter = index.chunkHashes('docs/a.md')
    expect([...aAfter.keys()]).toEqual([...aBefore.keys()])
    const [firstId, secondId] = [...aBefore.keys()]
    expect(aAfter.get(firstId ?? '')).toBe(aBefore.get(firstId ?? ''))
    expect(aAfter.get(secondId ?? '')).not.toBe(aBefore.get(secondId ?? ''))

    // B is gone from chunks and chunks_vec; the manifest points at the new head.
    expect(index.documentPaths()).toEqual(['docs/a.md', 'docs/c.md'])
    const nearB = index.searchVectors(fakeVector(provider.embedded[1] ?? '', 8), 10)
    expect(nearB.map((hit) => hit.docPath)).not.toContain('docs/b.md')
    expect(nearB).toHaveLength(3)
    expect(index.getManifest()?.commitSha).toBe(head)

    // The changed chunk is searchable by its new vector.
    const echo = index.searchVectors(fakeVector(provider.embedded[0] ?? '', 8), 1)[0]
    expect(echo?.chunkId).toBe(secondId)
    expect(echo?.distance).toBeCloseTo(0, 5)
  })

  it('embeds nothing when nothing changed', async () => {
    const provider = new RecordingProvider()
    const head = await commit('initial')
    await sync(provider)
    provider.calls.length = 0

    const report = await sync(provider)

    expect(report).toMatchObject({
      mode: 'incremental',
      headSha: head,
      documents: { added: 0, modified: 0, unchanged: 0, deleted: 0 },
      vectors: { needed: 0, embedded: 0, cached: 0 },
    })
    expect(provider.calls).toEqual([])
  })

  it('rebuilds a deleted index entirely from the embedding cache', async () => {
    const provider = new RecordingProvider()
    await commit('initial')
    await sync(provider)
    closeIndexes()
    rmSync(sourceIndexPath(dataDir, source.id))
    provider.calls.length = 0

    const report = await sync(provider)

    expect(report).toMatchObject({
      mode: 'full',
      reason: 'no previous sync',
      vectors: { needed: 3, embedded: 0, cached: 3 },
    })
    expect(provider.calls).toEqual([])
    expect(indexes().index.stats().chunks).toBe(3)
  })

  it('rebuilds after a chunker version change without embedding unchanged text', async () => {
    const provider = new RecordingProvider()
    await commit('initial')
    await sync(provider)
    const { index } = indexes()
    const manifest = index.getManifest()
    if (manifest === undefined) throw new Error('expected a manifest')
    index.applyChanges({
      documents: [],
      deletePaths: [],
      manifest: { ...manifest, chunkerVersion: 0 },
    })
    provider.calls.length = 0

    const report = await sync(provider)

    expect(report.mode).toBe('full')
    expect(report.reason).toMatch(/^chunker version changed from 0 to \d+$/)
    expect(report.chunks).toMatchObject({ unchanged: 3, added: 0, changed: 0 })
    expect(provider.calls).toEqual([])
  })

  it('rebuilds when the include paths change', async () => {
    const provider = new RecordingProvider()
    write('extra/x.md', `# X\n\n${paragraph(50, 'xray')}\n`)
    await commit('initial')
    await sync(provider)
    provider.calls.length = 0
    source = demoSource(source.repo, ['docs', 'extra'])

    const report = await sync(provider)

    expect(report).toMatchObject({ mode: 'full', reason: 'include paths changed' })
    expect(report.documents.added).toBe(1)
    expect(provider.embedded).toHaveLength(1)
    expect(provider.embedded[0]).toContain('xray')
  })

  it('re-embeds everything into a new vector table when the embedding model changes', async () => {
    await commit('initial')
    await sync(new RecordingProvider({ dimensions: 8 }))
    const smaller = new RecordingProvider({ dimensions: 4 })

    const report = await sync(smaller)

    expect(report.reason).toBe('embedding model changed from fake:hash:8 to fake:hash:4')
    expect(report.vectors).toEqual({ needed: 3, embedded: 3, cached: 0 })
    const { index } = indexes()
    expect(index.getManifest()).toMatchObject({ embedModel: 'fake:hash:4', embedDimensions: 4 })
    expect(index.searchVectors(fakeVector(smaller.embedded[0] ?? '', 4), 1)).toHaveLength(1)
  })

  it('batches embedding requests within the provider limits', async () => {
    const provider = new RecordingProvider({ maxInputs: 2 })
    write('docs/c.md', docC)
    await commit('initial')

    await sync(provider)

    expect(provider.calls.map((call) => call.texts.length)).toEqual([2, 2])
    expect(provider.calls.every((call) => call.inputType === 'document')).toBe(true)
  })
})
