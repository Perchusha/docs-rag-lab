// Sync against local file:// repositories in the OS temp dir (no network).
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { listSourceFiles } from './files.ts'
import { git } from './git.ts'
import { parseNameStatus, syncRepo } from './sync.ts'
import type { Source } from './types.ts'

let root: string
let upstream: string
let checkout: string

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

function source(): Source {
  return {
    id: 'demo',
    repo: pathToFileURL(upstream).href,
    branch: 'main',
    include: ['docs/guide', 'docs/notes'],
    license: { name: 'MIT', url: 'https://example.com', attribution: 'Demo' },
    match: (path) => path.endsWith('.md'),
    parse: () => Promise.reject(new Error('not used')),
  }
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'drl-sync-'))
  upstream = join(root, 'upstream')
  checkout = join(root, 'cache', 'sources', 'demo')
  // Hermetic git: no user or system config, except what the test sets.
  const globalConfig = join(root, 'gitconfig')
  writeFileSync(globalConfig, '[user]\n\tname = Test\n\temail = test@example.com\n')
  vi.stubEnv('GIT_CONFIG_GLOBAL', globalConfig)
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1')

  mkdirSync(upstream)
  await git(['init', '--quiet', '-b', 'main'], { cwd: upstream })
  // Let shallow, filtered clones and fetch-by-SHA work over file://.
  await git(['config', 'uploadpack.allowFilter', 'true'], { cwd: upstream })
  await git(['config', 'uploadpack.allowAnySHA1InWant', 'true'], { cwd: upstream })
  write('docs/guide/intro.md', '# Intro\n')
  write('docs/guide/Everyday Types.md', '# Types\n')
  write('docs/notes/1.0.md', '# 1.0\n')
  write('docs/other/skip.md', '# Not included\n')
  write('README.md', 'root file\n')
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(root, { recursive: true, force: true })
})

describe('syncRepo', { timeout: 30_000 }, () => {
  it('clones only the include paths on the first sync and reports a full build', async () => {
    const head = await commit('initial')

    const result = await syncRepo(source(), { checkoutDir: checkout })

    expect(result).toEqual({ headSha: head, mode: 'full', reason: 'no previous sync' })
    expect(existsSync(join(checkout, 'docs/other'))).toBe(false)
    expect(listSourceFiles(checkout, source()).map((file) => file.path)).toEqual([
      'docs/guide/Everyday Types.md',
      'docs/guide/intro.md',
      'docs/notes/1.0.md',
    ])
  })

  it('reports changed and deleted files under the include paths since the previous sync', async () => {
    const first = await commit('initial')
    await syncRepo(source(), { checkoutDir: checkout })

    write('docs/guide/Everyday Types.md', '# Types, edited\n')
    write('docs/notes/2.0 beta.md', '# 2.0\n')
    rmSync(join(upstream, 'docs/guide/intro.md'))
    write('docs/other/skip.md', '# Still not included, edited\n')
    write('docs/guide/image.png', 'not markdown')
    const second = await commit('edit, add, delete')

    const result = await syncRepo(source(), { checkoutDir: checkout, previousSha: first })

    expect(result).toEqual({
      headSha: second,
      mode: 'incremental',
      changed: ['docs/guide/Everyday Types.md', 'docs/notes/2.0 beta.md'],
      deleted: ['docs/guide/intro.md'],
    })
    expect(readFileSync(join(checkout, 'docs/guide/Everyday Types.md'), 'utf8')).toBe(
      '# Types, edited\n',
    )
  })

  it('reports no changes when the branch has not moved', async () => {
    const head = await commit('initial')
    await syncRepo(source(), { checkoutDir: checkout })

    expect(await syncRepo(source(), { checkoutDir: checkout, previousSha: head })).toEqual({
      headSha: head,
      mode: 'incremental',
      changed: [],
      deleted: [],
    })
  })

  it('falls back to a full build when the previous commit is unreachable', async () => {
    const head = await commit('initial')
    const missing = 'f'.repeat(40)

    const result = await syncRepo(source(), { checkoutDir: checkout, previousSha: missing })

    expect(result).toEqual({
      headSha: head,
      mode: 'full',
      reason: `previous commit ${missing} is not reachable`,
    })
  })

  it('diffs against a previous commit that a fresh clone does not have yet', async () => {
    const first = await commit('initial')
    write('docs/notes/1.0.md', '# 1.0, edited\n')
    const second = await commit('edit')

    // A deleted cache directory: the shallow clone only has the newest commit.
    const result = await syncRepo(source(), { checkoutDir: checkout, previousSha: first })

    expect(result).toEqual({
      headSha: second,
      mode: 'incremental',
      changed: ['docs/notes/1.0.md'],
      deleted: [],
    })
  })

  it('reports a full build when asked to', async () => {
    const head = await commit('initial')
    expect(
      await syncRepo(source(), { checkoutDir: checkout, previousSha: head, full: true }),
    ).toEqual({ headSha: head, mode: 'full', reason: 'requested' })
  })

  it('keeps LF line endings even when the user config sets core.autocrlf=true', async () => {
    writeFileSync(
      join(root, 'gitconfig'),
      '[user]\n\tname = Test\n\temail = test@example.com\n[core]\n\tautocrlf = true\n',
    )
    write('docs/guide/lines.md', 'one\ntwo\n')
    await commit('lf file')

    await syncRepo(source(), { checkoutDir: checkout })

    expect(readFileSync(join(checkout, 'docs/guide/lines.md'), 'utf8')).toBe('one\ntwo\n')
  })
})

describe('parseNameStatus', () => {
  it('splits NUL-separated status and path pairs', () => {
    expect(parseNameStatus('M\0a b.md\0A\0c.md\0D\0d.md\0T\0e.md\0')).toEqual({
      changed: ['a b.md', 'c.md', 'e.md'],
      deleted: ['d.md'],
    })
  })
})
