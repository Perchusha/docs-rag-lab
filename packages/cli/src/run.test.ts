import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

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

  it('reports a dotenv file it cannot read as a failed command, with the usage line', async () => {
    mkdirSync(join(root, '.env'))
    const out = capture()
    const err = capture()

    expect(await run(['limits'], { out: out.writer, err: err.writer, root })).toBe(1)
    expect(err.text()).toContain('drl limits failed:')
    expect(out.text()).toContain('usage: no API calls')
  })

  it('explains an empty index without a stack trace unless DRL_DEBUG is set', async () => {
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
    expect(err.text()).toContain('the index is empty: run drl sync first')
    expect(err.text()).toContain('Set DRL_DEBUG=1')
    expect(err.text()).not.toMatch(/\n\s+at /)

    const debug = capture()
    await run(['ask', 'q'], { out: capture().writer, err: debug.writer, root, debug: true })
    expect(debug.text()).toMatch(/\n\s+at /)
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

    // It gets as far as the (empty) index, past every key and flag check.
    expect(code).toBe(1)
    expect(err.text()).toContain('drl search failed: the index is empty: run drl sync first')
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
    expect(err.text()).toContain('--top-k must be a positive integer')
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
