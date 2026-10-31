import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { listSourceFiles, normalizeText, readSourceFile } from './files.ts'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'drl-files-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('normalizeText', () => {
  it('turns CRLF and lone CR into LF and drops a BOM', () => {
    expect(normalizeText(`${String.fromCodePoint(0xfeff)}a\r\nb\rc\n`)).toBe('a\nb\nc\n')
  })
})

describe('listSourceFiles', () => {
  it('lists matching files under the include paths with POSIX paths, sorted', () => {
    mkdirSync(join(root, 'docs/a/deep'), { recursive: true })
    mkdirSync(join(root, 'docs/b'), { recursive: true })
    writeFileSync(join(root, 'docs/a/deep/Two Words.md'), 'x\r\n')
    writeFileSync(join(root, 'docs/a/one.md'), 'y')
    writeFileSync(join(root, 'docs/a/skip.txt'), 'z')
    writeFileSync(join(root, 'docs/b/out.md'), 'not included')

    const files = listSourceFiles(root, {
      include: ['docs/a', 'docs/missing'],
      match: (path) => path.endsWith('.md'),
    })

    expect(files).toEqual([
      { path: 'docs/a/deep/Two Words.md', content: 'x\n' },
      { path: 'docs/a/one.md', content: 'y' },
    ])
  })

  it('reads a single file the same way', () => {
    writeFileSync(join(root, 'f.md'), 'a\r\n')
    expect(readSourceFile(root, 'f.md')).toEqual({ path: 'f.md', content: 'a\n' })
  })
})
