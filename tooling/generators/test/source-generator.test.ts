// The real generator, through @turbo/gen's own CLI, on a throwaway repository in the OS temp
// dir. No network: `turbo gen` fetches its own copy of this CLI, and node_modules has the one the
// catalog pins.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { runSourceConformance, type Source } from '@docs-rag-lab/source-kit'
import { check, resolveConfig } from 'prettier'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const CONFIG = fileURLToPath(new URL('../turbo/generators/config.ts', import.meta.url))
const CLI = join(
  dirname(createRequire(import.meta.url).resolve('@turbo/gen/package.json')),
  'dist/cli.js',
)

const REACT = {
  id: 'react',
  repo: 'https://github.com/reactjs/react.dev',
  branch: 'main',
  site: 'https://react.dev',
  includes: 'src/content/learn:handbook,src/content/reference/:reference',
  licenseName: 'CC BY 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  attribution: "The docs' authors",
}

let root: string

function generate(answers: Partial<typeof REACT> = {}) {
  const args = Object.values({ ...REACT, ...answers })
  const result = spawnSync(
    process.execPath,
    [CLI, 'run', 'source', '--root', root, '--config', CONFIG, '--args', ...args],
    { encoding: 'utf8' },
  )
  return { status: result.status, output: `${result.stdout}${result.stderr}` }
}

function filesOf(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort()
}

const sourceDir = (id: string): string => join(root, 'packages', 'sources', id)

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'drl-gen-'))
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'tmp', private: true, packageManager: 'pnpm@12.16.1' }),
  )
  writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n')
  writeFileSync(join(root, 'pnpm-lock.yaml'), '')
  writeFileSync(join(root, 'turbo.json'), '{}')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('turbo gen source', () => {
  it('writes the package, with nothing of the templates left in it', () => {
    const { status, output } = generate()

    expect(output).toContain('8 files added')
    expect(status).toBe(0)
    const files = filesOf(sourceDir('react'))
    expect(files).toEqual([
      '__fixtures__/SOURCE.txt',
      'eslint.config.js',
      'package.json',
      'src/index.ts',
      'src/paths.ts',
      'test/conformance.test.ts',
      'tsconfig.json',
      'vitest.config.js',
    ])
    for (const file of files) {
      expect(readFileSync(join(sourceDir('react'), file), 'utf8')).not.toMatch(/\{\{|\}\}/)
    }
    const manifest = JSON.parse(readFileSync(join(sourceDir('react'), 'package.json'), 'utf8')) as {
      name: string
      exports: unknown
      dependencies: Record<string, string>
    }
    expect(manifest.name).toBe('@docs-rag-lab/source-react')
    expect(manifest.exports).toEqual({ '.': './src/index.ts' })
    // Sources import only source-kit (rule sources-only-source-kit).
    expect(Object.keys(manifest.dependencies)).toEqual(['@docs-rag-lab/source-kit'])
  })

  it('writes what Prettier would, so format:check stays green', async () => {
    generate()

    const options = await resolveConfig(CONFIG)
    for (const file of filesOf(sourceDir('react')).filter((name) => !name.endsWith('.txt'))) {
      const path = join(sourceDir('react'), file)
      expect(await check(readFileSync(path, 'utf8'), { ...options, filepath: path }), file).toBe(
        true,
      )
    }
  })

  it('gives a source that passes everything in the conformance suite but the parser', async () => {
    generate()
    const { reactSource } = (await import(
      /* @vite-ignore */ pathToFileURL(join(sourceDir('react'), 'src/index.ts')).href
    )) as { reactSource: () => Source }
    const source = reactSource()

    expect(source).toMatchObject({
      id: 'react',
      repo: REACT.repo,
      branch: 'main',
      include: ['src/content/learn', 'src/content/reference'],
      license: { name: REACT.licenseName, url: REACT.licenseUrl, attribution: REACT.attribution },
    })
    expect(source.match('src/content/learn/a.md')).toBe(true)
    expect(source.match('src/content/reference/b/c.mdx')).toBe(true)
    expect(source.match('src/content/blog/a.md')).toBe(false)
    expect(source.match('src/content/learn/a.png')).toBe(false)

    const path = 'src/content/learn/a.md'
    const { failures } = await runSourceConformance(source, {
      files: [{ path, content: '# A\n' }],
      urlPattern: /^https:\/\/react\.dev\//,
    })
    expect(failures).toEqual([`${path}: parse threw: ${path}: the react parser is not written yet`])
  })

  it('escapes the site into the fixtures test, and names things after a hyphenated id', () => {
    generate({ id: 'rust-book', site: 'https://doc.rust-lang.org' })

    const test = readFileSync(join(sourceDir('rust-book'), 'test/conformance.test.ts'), 'utf8')
    expect(test).toContain(String.raw`urlPattern: /^https:\/\/doc\.rust-lang\.org\//`)
    expect(test).toContain("import { rustBookSource } from '../src/index.ts'")
    const index = readFileSync(join(sourceDir('rust-book'), 'src/index.ts'), 'utf8')
    expect(index).toContain('export function rustBookSource(options: RustBookSourceOptions = {})')
  })

  it.each([
    ['an id that is not lowercase', { id: 'React' }, 'lowercase'],
    ['an id with a path in it', { id: '../react' }, 'lowercase'],
    ['a doc type source-kit does not have', { includes: 'docs:wiki' }, '"wiki" is not a doc type'],
    ['an include with no doc type', { includes: 'docs' }, 'is not a doc type'],
    ['a repository that is not https', { repo: 'git@github.com:a/b.git' }, 'https'],
  ])('refuses %s, and writes nothing', (_name, answers, message) => {
    const { output } = generate(answers)

    expect(output).toContain(message)
    expect(existsSync(join(root, 'packages'))).toBe(false)
  })

  it('does not overwrite a source that exists', () => {
    generate()
    const index = join(sourceDir('react'), 'src/index.ts')
    writeFileSync(index, '// the parser, by now\n')

    const { output } = generate()

    expect(output).toContain('File already exists')
    expect(readFileSync(index, 'utf8')).toBe('// the parser, by now\n')
  })
})
