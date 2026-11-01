import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { RetrievalTrace } from '@docs-rag-lab/contracts'
import { createEmbeddingProvider, embeddingCacheKey, openIndexes } from '@docs-rag-lab/core'
import { settings } from '@docs-rag-lab/settings'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { run, USAGE } from './run.ts'

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

let root: string

beforeEach(() => {
  // An empty repo root: no dotenv file, so only the stubbed environment counts.
  root = mkdtempSync(join(tmpdir(), 'drl-run-'))
  writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages: []\n')
  vi.stubEnv('VOYAGE_API_KEY', undefined)
  vi.stubEnv('ANTHROPIC_API_KEY', undefined)
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(root, { recursive: true, force: true })
})

describe('run', () => {
  it('prints usage for --help', async () => {
    const out = capture()
    expect(await run(['--help'], { out: out.writer, root })).toBe(0)
    expect(out.text()).toBe(USAGE)
  })

  it('rejects unknown commands and options with exit code 2', async () => {
    const err = capture()
    expect(await run(['index'], { err: err.writer, root })).toBe(2)
    expect(err.text()).toContain('unknown command "index"')
    expect(await run(['sync', '--nope'], { err: err.writer, root })).toBe(2)
  })

  it('fails a command without its key, and still reports usage', async () => {
    const out = capture()
    const err = capture()

    const code = await run(['sync', 'typescript'], { out: out.writer, err: err.writer, root })

    expect(code).toBe(1)
    expect(err.text()).toContain('drl sync failed: VOYAGE_API_KEY is not set')
    expect(out.text()).toContain('usage: no API calls, 0 tokens, $0.0000')
  })

  it('reports an unexpected failure with a hint, and its stack trace only with DRL_DEBUG', async () => {
    // A directory where the dotenv file should be: not a usage error.
    mkdirSync(join(root, '.env'))
    const out = capture()
    const err = capture()

    expect(await run(['limits'], { out: out.writer, err: err.writer, root, debug: false })).toBe(1)
    expect(err.text()).toContain('drl limits failed:')
    expect(err.text()).toContain('Set DRL_DEBUG=1')
    expect(err.text()).not.toMatch(/\n\s+at /)
    expect(out.text()).toContain('usage: no API calls')

    const debug = capture()
    await run(['limits'], { out: capture().writer, err: debug.writer, root, debug: true })
    expect(debug.text()).toMatch(/\n\s+at /)
  })

  it('says to sync first when there is no index, without a stack trace hint', async () => {
    vi.stubEnv('VOYAGE_API_KEY', 'pa-test')
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test')
    const err = capture()

    const code = await run(['ask', 'What is a union type?'], {
      out: capture().writer,
      err: err.writer,
      root,
      debug: false,
    })

    expect(code).toBe(1)
    expect(err.text()).toContain(
      'there is no index for typescript yet: run drl sync typescript first',
    )
    expect(err.text()).not.toContain('DRL_DEBUG')
  })

  it('names the configured sources when the source is unknown', async () => {
    vi.stubEnv('VOYAGE_API_KEY', 'pa-test')
    const err = capture()
    expect(await run(['sync', 'react'], { out: capture().writer, err: err.writer, root })).toBe(1)
    expect(err.text()).toContain('unknown source "react" (configured: typescript)')
  })

  it('validates --strategy and --doc-type before calling any API', async () => {
    const err = capture()
    expect(
      await run(['search', 'q', '--strategy', 'bm25'], {
        out: capture().writer,
        err: err.writer,
        root,
      }),
    ).toBe(1)
    expect(err.text()).toContain('--strategy must be one of vector, hybrid, got "bm25"')

    expect(
      await run(['ask', 'q', '--doc-type', 'option,manual'], {
        out: capture().writer,
        err: err.writer,
        root,
      }),
    ).toBe(1)
    expect(err.text()).toContain(
      '--doc-type must be one of handbook, reference, option, release-notes, other, got "manual"',
    )
  })

  it('searches without an Anthropic key, since search never calls Claude', async () => {
    vi.stubEnv('VOYAGE_API_KEY', 'pa-test')
    const err = capture()

    const code = await run(['search', 'What is a union type?', '--doc-type', 'option', '--json'], {
      out: capture().writer,
      err: err.writer,
      root,
    })

    // It gets past every flag check to the index, which comes before the Voyage key, and
    // creates no index file.
    expect(code).toBe(1)
    expect(err.text()).toContain(
      'drl search failed: there is no index for typescript yet: run drl sync typescript first',
    )
    expect(existsSync(join(root, 'data', 'sources', 'typescript.sqlite'))).toBe(false)
  })

  it('prints the whole trace as JSON from a seeded index, with the query vector from the cache', async () => {
    vi.stubEnv('VOYAGE_API_KEY', 'pa-test')
    const question = 'What does error TS2345 mean?'
    const { dimensions } = settings.embeddings
    const providerId = createEmbeddingProvider(settings.embeddings).id
    const unit = (i: number) =>
      Float32Array.from({ length: dimensions }, (_, j) => (j === i ? 1 : 0))
    const chunk = (id: string, text: string, vector: Float32Array) => ({
      id,
      ordinal: 0,
      headingPath: [id],
      anchor: id,
      blockTypes: ['prose'],
      text,
      metadata: {},
      tokenCount: 5,
      textHash: id,
      vector,
    })
    // Seed data/ in the temp root: two chunks, and the question's vector in the cache.
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
          chunks: [
            chunk('code', 'A > code\n\n// @errors: 2345', unit(0)),
            chunk('near', 'A > near\n\nArguments and parameters.', unit(1)),
          ],
        },
      ],
      deletePaths: [],
      manifest: {
        sourceId: 'typescript',
        repo: 'r',
        branch: 'v2',
        includePaths: [],
        commitSha: 's',
        syncedAt: '2026-10-31T00:00:00.000Z',
        embedModel: providerId,
        embedDimensions: dimensions,
        contextModel: null,
        chunkerVersion: 2,
        parserVersion: 1,
      },
    })
    indexes.cache.putMany([
      {
        key: embeddingCacheKey(providerId, 'query', question),
        provider: providerId,
        inputType: 'query',
        vector: unit(1),
      },
    ])
    indexes.close()
    const out = capture()
    const err = capture()

    const code = await run(['search', question, '--json'], {
      out: out.writer,
      err: err.writer,
      root,
    })

    expect(code).toBe(0)
    const trace = JSON.parse(out.text()) as RetrievalTrace
    expect(trace).toMatchObject({ version: 2, strategy: 'hybrid', sourceId: 'typescript' })
    expect(trace.embedding.from).toBe('cache')
    expect(trace.lists.find((list) => list.name === 'exact')?.candidates[0]?.chunkId).toBe('code')
    expect(trace.context.map((c) => c.chunkId)).toEqual(['code', 'near'])
    expect(err.text()).toContain('0 tokens in 0 requests, 1 cached')
  })

  it('keeps stdout for the JSON alone with --json, and reports usage on stderr', async () => {
    vi.stubEnv('VOYAGE_API_KEY', 'pa-test')
    const out = capture()
    const err = capture()

    await run(['search', 'q', '--json'], { out: out.writer, err: err.writer, root })

    expect(out.text()).toBe('')
    expect(err.text()).toContain('usage: no API calls')
  })

  it('asks for a question for search too', async () => {
    const err = capture()
    expect(await run(['search'], { out: capture().writer, err: err.writer, root })).toBe(1)
    expect(err.text()).toContain('search needs a question')
  })

  it('validates --top-k', async () => {
    const err = capture()
    expect(
      await run(['ask', 'q', '--top-k', '0'], { out: capture().writer, err: err.writer, root }),
    ).toBe(1)
    expect(err.text()).toContain('--top-k must be a whole number from 1 to 100')
    expect(
      await run(['search', 'q', '--top-k', '4097'], {
        out: capture().writer,
        err: err.writer,
        root,
      }),
    ).toBe(1)
    expect(err.text()).not.toContain('k value in knn query')
  })

  it('accepts --json only with search', async () => {
    const err = capture()
    expect(
      await run(['ask', 'q', '--json'], { out: capture().writer, err: err.writer, root }),
    ).toBe(2)
    expect(err.text()).toContain('--json works only with search')
  })
})

describe('bin.ts', () => {
  it('runs under plain node, importing workspace packages through node_modules', () => {
    const bin = fileURLToPath(new URL('./bin.ts', import.meta.url))
    const result = spawnSync(process.execPath, [bin, '--help'], { encoding: 'utf8' })

    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('sync <source> [--full]')
  })
})
