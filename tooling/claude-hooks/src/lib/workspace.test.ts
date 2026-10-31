import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { findWorkspacePackage, isCheckedFile } from './workspace.ts'

let root = ''

function file(path: string, content = ''): string {
  const full = join(root, path)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, content)
  return full
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'claude-hooks-workspace-'))
  file('package.json', JSON.stringify({ name: 'docs-rag-lab' }))
  file('packages/core/package.json', JSON.stringify({ name: '@docs-rag-lab/core' }))
  file(
    'packages/sources/typescript/package.json',
    JSON.stringify({ name: '@docs-rag-lab/source-typescript' }),
  )
  file('packages/nameless/package.json', JSON.stringify({ private: true }))
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('findWorkspacePackage', () => {
  it('finds the package that owns a nested source file', () => {
    const path = file('packages/core/src/retrieval/rrf.ts')

    expect(findWorkspacePackage(path, root)).toEqual({
      name: '@docs-rag-lab/core',
      dir: join(root, 'packages/core'),
    })
  })

  it('finds packages nested under packages/sources', () => {
    const path = file('packages/sources/typescript/src/index.ts')

    expect(findWorkspacePackage(path, root)?.name).toBe('@docs-rag-lab/source-typescript')
  })

  it('treats a package.json edit as belonging to its package', () => {
    expect(findWorkspacePackage(join(root, 'packages/core/package.json'), root)?.name).toBe(
      '@docs-rag-lab/core',
    )
  })

  it('returns null for files that only the root package covers', () => {
    expect(findWorkspacePackage(file('turbo.json'), root)).toBeNull()
    expect(findWorkspacePackage(file('docs/adr/0001-stack.md'), root)).toBeNull()
  })

  it('returns null outside the project and for a package without a name', () => {
    expect(findWorkspacePackage(join(tmpdir(), 'elsewhere.ts'), root)).toBeNull()
    expect(findWorkspacePackage(file('packages/nameless/src/index.ts'), root)).toBeNull()
  })
})

describe('isCheckedFile', () => {
  it.each(['src/index.ts', 'src/Chat.tsx', 'eslint.config.js', 'x.cjs', 'package.json'])(
    'checks %s',
    (path) => {
      expect(isCheckedFile(path)).toBe(true)
    },
  )

  it.each(['CLAUDE.md', 'README.md', 'logo.png', 'packages/core/node_modules/x/index.js'])(
    'skips %s',
    (path) => {
      expect(isCheckedFile(path)).toBe(false)
    },
  )
})
