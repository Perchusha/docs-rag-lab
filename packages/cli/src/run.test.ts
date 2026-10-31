import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

  it('names the configured sources when the source is unknown', async () => {
    vi.stubEnv('VOYAGE_API_KEY', 'pa-test')
    const err = capture()
    expect(await run(['sync', 'react'], { out: capture().writer, err: err.writer, root })).toBe(1)
    expect(err.text()).toContain('unknown source "react" (configured: typescript)')
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
