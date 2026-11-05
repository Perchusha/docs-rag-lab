// `drl sync --compiled` end to end (ADR-0017), over a local git repository in the OS temp dir,
// with a fake compiler and a fake Voyage client. Nothing reaches the network.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  COMPILER_IDENTITY_PREFIX,
  openIndexes,
  variantIndexPath,
  type CompileOptions,
  type CompiledSource,
  type EmbeddingProvider,
  type Source,
} from '@docs-rag-lab/core'
import type { Block, ParsedDoc, SourceFile } from '@docs-rag-lab/source-kit'
import { settings as realSettings } from '@docs-rag-lab/settings'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { run } from './run.ts'
import { compileRecordPath, type CompileRecord } from './sync-compiled.ts'

vi.setConfig({ testTimeout: 60_000, hookTimeout: 30_000 })

const settings = {
  ...realSettings,
  embeddings: { ...realSettings.embeddings, rateLimit: { rpm: 1_000_000, tpm: 1_000_000_000 } },
}

let root: string
let upstream: string
let source: Source
/** The same source with no compiled index. */
let plainOnly: Source
let commitSha: string
let embedded: string[]
/** Which examples the fake compiler fails, by their code. */
let failing: Set<string>

const provider: EmbeddingProvider = {
  id: `voyage:${settings.embeddings.model}:${String(settings.embeddings.dimensions)}`,
  model: settings.embeddings.model,
  dimensions: settings.embeddings.dimensions,
  limits: settings.embeddings.batch,
  embed: (texts) => {
    embedded.push(...texts)
    const vector = (text: string) => {
      const bytes = createHash('sha256').update(text).digest()
      return Float32Array.from(
        { length: settings.embeddings.dimensions },
        (_, i) => bytes[i % 32] ?? 1,
      )
    }
    return Promise.resolve({ vectors: texts.map(vector), tokens: texts.length })
  },
}

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
  const code = await run(argv, {
    settings,
    sources: [source],
    out: out.writer,
    err: err.writer,
    root,
    debug: false,
    createProvider: () => provider,
  })
  return { code, out: out.text(), err: err.text() }
}

const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: upstream, stdio: 'pipe', encoding: 'utf8' }).trim()

function write(path: string, content: string): void {
  const file = join(upstream, path)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, content)
}

/** Each document is a title, then sections of prose with one example each. */
function parsed(file: SourceFile, compile?: (code: string) => Block): ParsedDoc {
  const [title = '', ...rest] = file.content.split('\n')
  const sections = rest
    .join('\n')
    .split(/^## /m)
    .slice(1)
    .map((part) => {
      const [heading = '', example = ''] = part.split('\n')
      const code: Block = { kind: 'code', lang: 'ts', code: example }
      return {
        headingPath: [heading],
        anchor: heading.toLowerCase(),
        blocks: [
          { kind: 'prose' as const, text: `About ${heading}.` },
          compile === undefined ? code : compile(example),
        ],
      }
    })
  return {
    title: title.replace(/^# /, ''),
    url: `https://docs.example.com/${file.path}`,
    docType: 'handbook',
    sections,
    metadata: {},
  }
}

const compiledRecord = (): CompileRecord =>
  JSON.parse(readFileSync(compileRecordPath(root, 'demo', commitSha), 'utf8')) as CompileRecord

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'drl-compiled-'))
  upstream = join(root, 'upstream')
  embedded = []
  failing = new Set()
  const globalConfig = join(root, 'gitconfig')
  writeFileSync(globalConfig, '[user]\n\tname = Test\n\temail = test@example.com\n')
  vi.stubEnv('GIT_CONFIG_GLOBAL', globalConfig)
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1')
  mkdirSync(upstream)
  git('init', '--quiet', '-b', 'main')
  git('config', 'uploadpack.allowFilter', 'true')
  git('config', 'uploadpack.allowAnySHA1InWant', 'true')
  write('pnpm-workspace.yaml', 'packages: []\n')
  write('docs/a.md', '# A\n\n## First\nlet a = 1\n\n## Second\nlet b = 2\n')
  write('docs/b.md', '# B\n\n## Only\nlet c = 3\n')
  git('add', '-A')
  git('commit', '--quiet', '-m', 'initial')
  commitSha = git('rev-parse', 'HEAD')
  const base: Omit<Source, 'compiled'> = {
    id: 'demo',
    repo: pathToFileURL(upstream).href,
    branch: 'main',
    include: ['docs'],
    license: { name: 'MIT', url: 'https://example.com', attribution: 'Demo' },
    parserVersion: 1,
    match: (path) => path.endsWith('.md'),
    parse: (file) => Promise.resolve(parsed(file)),
  }
  plainOnly = base
  source = {
    ...base,
    compiled: (options: CompileOptions = {}): CompiledSource => ({
      ...base,
      parserVersion: 2,
      compiler: 'fake 1',
      parse: (file) => {
        let index = 0
        return Promise.resolve(
          parsed(file, (code) => {
            const ok = !failing.has(code)
            options.onResult?.({
              path: file.path,
              index: index++,
              lang: 'ts',
              ok,
              ...(ok ? {} : { reason: 'Expected errors were not raised: 2571' }),
            })
            return {
              kind: 'code',
              lang: 'ts',
              code,
              ...(ok
                ? {
                    compiled: {
                      errors: [],
                      queries: [{ target: 'x', line: code, text: `type of ${code}` }],
                    },
                  }
                : {}),
            }
          }),
        )
      },
    }),
  }
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(root, { recursive: true, force: true })
})

describe('drl sync --compiled', () => {
  it('needs the plain index first, since it is built at that commit', async () => {
    const { code, err } = await drl('sync', 'demo', '--compiled')
    expect(code).toBe(1)
    expect(err).toContain('run drl sync demo first')
  })

  it('says so for a source with no compiled index', async () => {
    source = plainOnly
    expect((await drl('sync', 'demo')).code).toBe(0)

    const { code, err } = await drl('sync', 'demo', '--compiled')
    expect(code).toBe(1)
    expect(err).toContain('demo has no compiled index')
  })

  describe('with a plain index', () => {
    beforeEach(async () => {
      expect((await drl('sync', 'demo')).code).toBe(0)
      embedded = []
    })

    it('compiles first, records it, and prints what it would embed, with no index, until --yes', async () => {
      const { code, out } = await drl('sync', 'demo', '--compiled')

      expect(code).toBe(0)
      expect(out).toContain(
        `compiled 3 of 3 examples (100.0%) with fake 1, at ${commitSha.slice(0, 8)}`,
      )
      expect(out).toContain('this would embed 2 texts')
      expect(embedded).toEqual([])
      expect(existsSync(variantIndexPath(join(root, settings.dataDir), 'demo', 'compiled'))).toBe(
        false,
      )
      expect(compiledRecord()).toEqual({
        compiler: 'fake 1',
        docsCommit: commitSha,
        examples: 3,
        compiled: 3,
        failed: [],
      })
    })

    it("builds the compiled index at the plain index's commit, naming its compiler", async () => {
      const { code } = await drl('sync', 'demo', '--compiled', '--yes')

      expect(code).toBe(0)
      expect(embedded).toHaveLength(2)
      expect(embedded.every((text) => text.includes('Compiler output:'))).toBe(true)
      const indexes = openIndexes(join(root, settings.dataDir), 'demo', {
        create: false,
        variant: 'compiled',
      })
      try {
        expect(indexes.index.getManifest()).toMatchObject({
          commitSha,
          contextModel: `${COMPILER_IDENTITY_PREFIX}fake 1`,
          parserVersion: 2,
        })
      } finally {
        indexes.close()
      }
      const plain = openIndexes(join(root, settings.dataDir), 'demo', { create: false })
      try {
        expect(plain.index.getManifest()?.contextModel).toBeNull()
      } finally {
        plain.close()
      }
    })

    it('stops below 90% compiled, before anything is embedded, and still records why', async () => {
      failing = new Set(['let b = 2'])

      const { code, out, err } = await drl('sync', 'demo', '--compiled', '--yes')

      expect(code).toBe(1)
      expect(out).toContain('compiled 2 of 3 examples (66.7%)')
      expect(out).toContain('Expected errors were not raised: <code>')
      expect(err).toContain('fewer than 90% of the examples compiled')
      expect(embedded).toEqual([])
      expect(compiledRecord().failed).toEqual([
        {
          path: 'docs/a.md',
          index: 1,
          lang: 'ts',
          reason: 'Expected errors were not raised: 2571',
        },
      ])
    })

    it('refuses a compile that differs from the one recorded for the same commit', async () => {
      await drl('sync', 'demo', '--compiled')
      failing = new Set(['let c = 3'])

      const { code, err } = await drl('sync', 'demo', '--compiled')

      expect(code).toBe(1)
      expect(err).toContain('the compile differs from the one recorded')
    })
  })
})
