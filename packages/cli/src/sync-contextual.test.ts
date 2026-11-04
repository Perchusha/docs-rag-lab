// `drl sync --contextual` end to end, over a local git repository in the OS temp dir, with fake
// Claude and Voyage clients. Nothing reaches the network.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  contextPromptHash,
  contextsPath,
  sourceIndexPath,
  variantIndexPath,
  type EmbeddingProvider,
  type EvalClient,
  type Source,
} from '@docs-rag-lab/core'
import { settings as realSettings } from '@docs-rag-lab/settings'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { run } from './run.ts'

vi.setConfig({ testTimeout: 60_000, hookTimeout: 30_000 })

const settings = {
  ...realSettings,
  embeddings: { ...realSettings.embeddings, rateLimit: { rpm: 1_000_000, tpm: 1_000_000_000 } },
}
const MODEL = settings.models.contextualize

let root: string
let upstream: string
let source: Source
let commitSha: string
let claudeCalls: string[]
let embedded: string[]
let stopReason: string

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

function fakeVector(text: string): Float32Array {
  const bytes = createHash('sha256').update(text).digest()
  return Float32Array.from({ length: settings.embeddings.dimensions }, (_, i) => bytes[i % 32] ?? 1)
}

const provider: EmbeddingProvider = {
  id: `voyage:${settings.embeddings.model}:${String(settings.embeddings.dimensions)}`,
  model: settings.embeddings.model,
  dimensions: settings.embeddings.dimensions,
  limits: settings.embeddings.batch,
  embed: (texts) => {
    embedded.push(...texts)
    return Promise.resolve({ vectors: texts.map(fakeVector), tokens: texts.length })
  },
}

const fakeClaude: EvalClient = {
  messages: {
    stream(request) {
      const content = request.messages[0]?.content
      const block = Array.isArray(content) ? content[1] : undefined
      const asked = block?.type === 'text' ? block.text : ''
      claudeCalls.push(asked)
      const name = /Text about (\w+)/.exec(asked)?.[1] ?? 'something'
      const message = {
        model: request.model,
        content: [{ type: 'text', text: `A context about ${name}.`, citations: null }],
        stop_reason: stopReason,
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 20 },
      } as never
      return {
        on: () => undefined,
        finalMessage: () => Promise.resolve(message),
        currentMessage: message,
      }
    },
    countTokens: () => Promise.resolve({ input_tokens: 100 }),
  },
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
    createEvalClient: () => fakeClaude,
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

const words = (name: string, count: number): string =>
  `Text about ${name}. ${Array.from({ length: count }, () => name).join(' ')}`

const dataDir = () => join(root, settings.dataDir)
const contextsFile = () => contextsPath(root, source.id, commitSha)
const fileLines = () =>
  readFileSync(contextsFile(), 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>)

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'drl-contextual-'))
  upstream = join(root, 'upstream')
  claudeCalls = []
  embedded = []
  stopReason = 'end_turn'
  const globalConfig = join(root, 'gitconfig')
  writeFileSync(globalConfig, '[user]\n\tname = Test\n\temail = test@example.com\n')
  vi.stubEnv('GIT_CONFIG_GLOBAL', globalConfig)
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1')
  mkdirSync(upstream)
  git('init', '--quiet', '-b', 'main')
  git('config', 'uploadpack.allowFilter', 'true')
  git('config', 'uploadpack.allowAnySHA1InWant', 'true')
  write('pnpm-workspace.yaml', 'packages: []\n')
  // Two sections of about 500 tokens each, so they become two chunks, and a shorter document.
  write(
    'docs/a.md',
    `# A\n\n## First\n\n${words('alpha', 400)}\n\n## Second\n\n${words('beta', 400)}\n`,
  )
  write('docs/b.md', `# B\n\n## Only\n\n${words('gamma', 100)}\n`)
  git('add', '-A')
  git('commit', '--quiet', '-m', 'initial')
  commitSha = git('rev-parse', 'HEAD')
  source = {
    id: 'demo',
    repo: pathToFileURL(upstream).href,
    branch: 'main',
    include: ['docs'],
    license: { name: 'MIT', url: 'https://example.com', attribution: 'Demo' },
    parserVersion: 1,
    match: (path) => path.endsWith('.md'),
    parse: (file) => {
      const [title = '', ...rest] = file.content.split('\n')
      const sections = rest
        .join('\n')
        .split(/^## /m)
        .slice(1)
        .map((part) => {
          const [heading = '', ...body] = part.split('\n')
          return {
            headingPath: [heading],
            anchor: heading.toLowerCase(),
            blocks: [{ kind: 'prose' as const, text: body.join('\n').trim() }],
          }
        })
      return Promise.resolve({
        title: title.replace(/^# /, ''),
        url: `https://docs.example.com/${file.path}`,
        docType: 'handbook',
        sections,
        metadata: {},
      })
    },
  }
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(root, { recursive: true, force: true })
})

describe('drl sync --contextual', () => {
  it('needs the plain index first, since it is built at that commit', async () => {
    const { code, err } = await drl('sync', 'demo', '--contextual')
    expect(code).toBe(1)
    expect(err).toContain('run drl sync demo first')
    expect(claudeCalls).toEqual([])
  })

  describe('with a plain index', () => {
    beforeEach(async () => {
      expect((await drl('sync', 'demo')).code).toBe(0)
      embedded = []
    })

    it('prints the estimate and stops, with no call and no second index, until --yes', async () => {
      const { code, out } = await drl('sync', 'demo', '--contextual')
      expect(code).toBe(0)
      expect(out).toContain(`this would write 3 contexts over 2 documents, about $`)
      expect(out).toContain(`with ${MODEL}, then embed 3 texts`)
      expect(out).toContain(`at docs commit ${commitSha.slice(0, 8)}: add --yes`)
      expect(claudeCalls).toEqual([])
      expect(embedded).toEqual([])
      expect(existsSync(variantIndexPath(dataDir(), 'demo', 'contextual'))).toBe(false)
      expect(existsSync(contextsFile())).toBe(false)
    })

    it('writes the contexts with their model and prompt, and embeds each with its chunk', async () => {
      const plainPath = sourceIndexPath(dataDir(), 'demo')
      const plain = readFileSync(plainPath)

      const { code, out } = await drl('sync', 'demo', '--contextual', '--yes')

      expect(code).toBe(0)
      expect(out).toContain('contexts: 3/3')
      expect(claudeCalls).toHaveLength(3)
      const [header, ...rows] = fileLines()
      expect(header).toEqual({
        version: 1,
        model: MODEL,
        promptHash: contextPromptHash(settings.contextualize),
        docsCommit: commitSha,
      })
      expect(rows.map(({ context }) => context).sort()).toEqual([
        'A context about alpha.',
        'A context about beta.',
        'A context about gamma.',
      ])
      const ids = rows.map(({ chunkId }) => chunkId as string)
      expect(ids).toEqual([...ids].sort())
      expect(embedded).toHaveLength(3)
      expect(embedded.every((text) => text.startsWith('A context about '))).toBe(true)
      expect(readFileSync(plainPath).equals(plain)).toBe(true)

      const check = await drl('eval', 'check', '--contextual')
      expect(check.out).toContain(
        "holds the plain index's 3 chunks, at its commit, with 3 contexts",
      )
    })

    it('calls nothing when the file holds every context and the cache every vector', async () => {
      await drl('sync', 'demo', '--contextual', '--yes')
      const before = readFileSync(contextsFile(), 'utf8')
      claudeCalls = []
      embedded = []

      const planned = await drl('sync', 'demo', '--contextual')
      expect(planned.out).toContain('this would write 0 contexts')
      expect(planned.out).toContain('then embed 0 texts')

      expect((await drl('sync', 'demo', '--contextual', '--yes')).code).toBe(0)
      expect(claudeCalls).toEqual([])
      expect(embedded).toEqual([])
      expect(readFileSync(contextsFile(), 'utf8')).toBe(before)
    })

    it('rebuilds a lost index from the committed file, with no call to Claude', async () => {
      await drl('sync', 'demo', '--contextual', '--yes')
      rmSync(variantIndexPath(dataDir(), 'demo', 'contextual'), { force: true })
      rmSync(`${variantIndexPath(dataDir(), 'demo', 'contextual')}-wal`, { force: true })
      rmSync(`${variantIndexPath(dataDir(), 'demo', 'contextual')}-shm`, { force: true })
      claudeCalls = []

      expect((await drl('sync', 'demo', '--contextual', '--yes')).code).toBe(0)
      expect(claudeCalls).toEqual([])
      expect((await drl('eval', 'check', '--contextual')).out).toContain('with 3 contexts')
    })

    it('runs a pilot: contexts for that many chunks, a forecast, and no index', async () => {
      const planned = await drl('sync', 'demo', '--contextual', '--pilot', '2')
      expect(planned.out).toContain('this would write 2 contexts over 1 documents')
      expect(planned.out).toContain('and no index: add --yes')
      expect(claudeCalls).toEqual([])

      const { code, out } = await drl('sync', 'demo', '--contextual', '--pilot', '2', '--yes')
      expect(code).toBe(0)
      expect(claudeCalls).toHaveLength(2)
      expect(out).toContain('docs/a.md (')
      expect(out).toContain('A context about alpha.')
      expect(out).toContain('the pilot: 2 contexts, $')
      expect(out).toContain('20 tokens out per context')
      expect(out).toContain('the forecast for all 3 contexts: about $')
      expect(embedded).toEqual([])
      expect(existsSync(variantIndexPath(dataDir(), 'demo', 'contextual'))).toBe(false)
      expect(fileLines()).toHaveLength(3)

      // What the pilot paid for is kept, so the full run pays only for the rest.
      claudeCalls = []
      expect((await drl('sync', 'demo', '--contextual', '--yes')).code).toBe(0)
      expect(claudeCalls).toHaveLength(1)
      expect(fileLines()).toHaveLength(4)
    })

    it('stops on a context it cannot use, and keeps none of it', async () => {
      stopReason = 'max_tokens'
      const { code, err } = await drl('sync', 'demo', '--contextual', '--yes')
      expect(code).toBe(1)
      expect(err).toContain('stopped with max_tokens')
      expect(err).not.toContain('DRL_DEBUG')
      expect(fileLines()).toHaveLength(1)
      expect(embedded).toEqual([])
    })

    it('builds the control with no call to Claude, and each chunk under its headings', async () => {
      const plainPath = sourceIndexPath(dataDir(), 'demo')
      const plain = readFileSync(plainPath)

      const planned = await drl('sync', 'demo', '--control')
      expect(planned.out).toContain('this would embed 3 texts')
      expect(planned.out).toContain('with no call to Claude: add --yes')
      expect(existsSync(variantIndexPath(dataDir(), 'demo', 'control'))).toBe(false)
      expect(embedded).toEqual([])

      const { code } = await drl('sync', 'demo', '--control', '--yes')
      expect(code).toBe(0)
      expect(claudeCalls).toEqual([])
      expect(existsSync(contextsFile())).toBe(false)
      expect(embedded).toHaveLength(3)
      expect(embedded.filter((text) => text.startsWith('A > First\n\n'))).toHaveLength(1)
      // A chunk that starts at the top of its document is under the title alone.
      expect(embedded.filter((text) => text.startsWith('B\n\nB\n\n## Only'))).toHaveLength(1)
      expect(readFileSync(plainPath).equals(plain)).toBe(true)
      expect(existsSync(variantIndexPath(dataDir(), 'demo', 'contextual'))).toBe(false)

      const check = await drl('eval', 'check', '--control')
      expect(check.out).toContain("the control index holds the plain index's 3 chunks")

      embedded = []
      expect((await drl('sync', 'demo', '--control', '--yes')).code).toBe(0)
      expect(embedded).toEqual([])
    })

    it('fails the check when the contextual index lags behind, and says why', async () => {
      await drl('sync', 'demo', '--contextual', '--yes')
      write('docs/c.md', `# C\n\n## Only\n\n${words('delta', 100)}\n`)
      git('add', '-A')
      git('commit', '--quiet', '-m', 'more')
      await drl('sync', 'demo')

      const { code, err } = await drl('eval', 'check', '--contextual')
      expect(code).toBe(1)
      expect(err).toContain('the contextual index differs')
      expect(err).toContain('only in the plain index')
    })
  })

  it.each<[string[], string]>([
    [['sync', 'demo', '--contextual', '--full'], 'no --full or --at'],
    [['sync', 'demo', '--contextual', '--at', 'a'.repeat(40)], 'no --full or --at'],
    [['sync', 'demo', '--pilot', '2'], '--pilot works only with sync --contextual'],
    [
      ['sync', 'demo', '--yes'],
      '--yes works with sync only together with --contextual or --control',
    ],
    [['search', 'q', '--contextual'], '--contextual works only with sync and eval check'],
    [['search', 'q', '--control'], '--control works only with sync and eval check'],
    [['sync', 'demo', '--control', '--contextual'], 'are two different indexes'],
    [['sync', 'demo', '--control', '--pilot', '2'], '--pilot works only with sync --contextual'],
    [['sync', 'demo', '--control', '--full'], 'no --full or --at'],
  ])('refuses %j', async (argv, message) => {
    const { code, err } = await drl(...argv)
    expect(code).toBe(2)
    expect(err).toContain(message)
  })

  it('refuses a pilot of no chunks, and --contextual with other eval commands', async () => {
    expect((await drl('sync', 'demo', '--contextual', '--pilot', '0')).err).toContain(
      '--pilot must be a whole number',
    )
    expect((await drl('eval', '--contextual')).err).toContain('--contextual does not apply')
    expect((await drl('eval', 'check', '--contextual', '--accept')).err).toContain(
      'it takes no --contextual',
    )
    expect((await drl('eval', '--control')).err).toContain('--control does not apply')
  })
})
