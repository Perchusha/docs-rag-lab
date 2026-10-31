import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CliError, findRepoRoot, loadEnv, requireKey } from './env.ts'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'drl-env-'))
  vi.stubEnv('DRL_TEST_FROM_FILE', undefined)
  vi.stubEnv('DRL_TEST_BOTH', 'from-shell')
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(root, { recursive: true, force: true })
})

describe('findRepoRoot', () => {
  it('walks up to the directory with pnpm-workspace.yaml', () => {
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages: []\n')
    mkdirSync(join(root, 'packages/cli/src'), { recursive: true })
    expect(findRepoRoot(join(root, 'packages/cli/src'))).toBe(root)
  })
})

describe('loadEnv', () => {
  it('loads the root dotenv file, and values already in the environment win', () => {
    writeFileSync(join(root, '.env'), 'DRL_TEST_FROM_FILE=file\nDRL_TEST_BOTH=from-file\n')

    expect(loadEnv(root)).toBe(true)
    expect(process.env.DRL_TEST_FROM_FILE).toBe('file')
    expect(process.env.DRL_TEST_BOTH).toBe('from-shell')
  })

  it('is fine without a dotenv file', () => {
    expect(loadEnv(root)).toBe(false)
  })
})

describe('requireKey', () => {
  it('returns a set key, trimmed', () => {
    expect(requireKey('VOYAGE_API_KEY', { VOYAGE_API_KEY: ' pa-123 ' })).toBe('pa-123')
  })

  it('names the missing key and points at .env.example', () => {
    const missing = () => requireKey('ANTHROPIC_API_KEY', { ANTHROPIC_API_KEY: '  ' })
    expect(missing).toThrow(CliError)
    expect(missing).toThrow(/ANTHROPIC_API_KEY is not set\. Copy \.env\.example/)
  })

  it('never puts a key value in an error', () => {
    const error = (() => {
      try {
        requireKey('VOYAGE_API_KEY', { ANTHROPIC_API_KEY: 'sk-secret-value' })
      } catch (e) {
        return e
      }
      return undefined
    })()
    expect(String(error)).not.toContain('sk-secret-value')
  })
})
