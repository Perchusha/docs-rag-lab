import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { readSourceFile, type ParsedDoc, type Block } from '@docs-rag-lab/source-kit'
import { describe, expect, it } from 'vitest'

import {
  errorCodesOf,
  exactTokensOf,
  matchPath,
  PARSER_VERSION,
  typescriptSource,
} from './index.ts'

const fixtureRoot = fileURLToPath(new URL('../__fixtures__/repo/', import.meta.url))
const DOCS = 'packages/documentation/copy/en'
const OPTIONS = 'packages/tsconfig-reference/copy/en/options'

const source = typescriptSource()

async function parse(path: string): Promise<ParsedDoc> {
  return source.parse(readSourceFile(fixtureRoot, path), { commitSha: undefined })
}

function allBlocks(doc: ParsedDoc): Block[] {
  return doc.sections.flatMap((section) => section.blocks)
}

describe('typescriptSource', () => {
  it('describes the upstream repository and the eight include paths', () => {
    expect(source).toMatchObject({
      id: 'typescript',
      repo: 'https://github.com/microsoft/TypeScript-Website',
      branch: 'v2',
    })
    expect(source.include).toEqual([
      `${DOCS}/handbook-v2`,
      `${DOCS}/reference`,
      `${DOCS}/modules-reference`,
      `${DOCS}/declaration-files`,
      `${DOCS}/project-config`,
      `${DOCS}/javascript`,
      `${DOCS}/release-notes`,
      OPTIONS,
    ])
  })

  it.each([
    [
      `${DOCS}/handbook-v2/Everyday Types.md`,
      'Everyday Types',
      'https://www.typescriptlang.org/docs/handbook/2/everyday-types.html',
      'handbook',
    ],
    [
      `${DOCS}/handbook-v2/Type Manipulation/Generics.md`,
      'Generics',
      'https://www.typescriptlang.org/docs/handbook/2/generics.html',
      'handbook',
    ],
    [
      `${DOCS}/reference/Utility Types.md`,
      'Utility Types',
      'https://www.typescriptlang.org/docs/handbook/utility-types.html',
      'reference',
    ],
    [
      `${DOCS}/modules-reference/guides/Choosing Compiler Options.md`,
      'Modules - Choosing Compiler Options',
      'https://www.typescriptlang.org/docs/handbook/modules/guides/choosing-compiler-options.html',
      'reference',
    ],
    [
      `${DOCS}/project-config/Compiler Options.md`,
      'tsc CLI Options',
      'https://www.typescriptlang.org/docs/handbook/compiler-options.html',
      'other',
    ],
    [
      `${DOCS}/release-notes/TypeScript 5.0.md`,
      'TypeScript 5.0',
      'https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-0.html',
      'release-notes',
    ],
    [
      `${OPTIONS}/strict.md`,
      'TSConfig Option: strict',
      'https://www.typescriptlang.org/tsconfig/strict.html',
      'option',
    ],
    [
      `${OPTIONS}/typeAcquisition/include.md`,
      'TSConfig Option: include',
      'https://www.typescriptlang.org/tsconfig/#type-include',
      'option',
    ],
  ])('parses %s with its live URL and doc type', async (path, title, url, docType) => {
    expect(await parse(path)).toMatchObject({ title, url, docType })
  })

  it('builds anchors the way typescriptlang.org does', async () => {
    const everyday = (await parse(`${DOCS}/handbook-v2/Everyday Types.md`)).sections
    expect(everyday.map((section) => section.anchor)).toEqual(
      expect.arrayContaining(['union-types', 'the-primitives-string-number-and-boolean']),
    )

    const utility = (await parse(`${DOCS}/reference/Utility Types.md`)).sections
    expect(utility.slice(1, 5).map((section) => [section.headingPath, section.anchor])).toEqual([
      [['Awaited<Type>'], 'awaitedtype'],
      [['Awaited<Type>', 'Example'], 'example'],
      [['Partial<Type>'], 'partialtype'],
      [['Partial<Type>', 'Example'], 'example-1'],
    ])

    const modules = await parse(`${DOCS}/modules-reference/guides/Choosing Compiler Options.md`)
    expect(modules.sections[0]?.anchor).toBe('im-writing-an-app')
  })

  it('gives option documents no section anchors', async () => {
    const doc = await parse(`${OPTIONS}/strict.md`)
    expect(doc.sections.every((section) => section.anchor === '')).toBe(true)
  })

  it('normalizes CRLF upstream files and keeps no frontmatter in the text', async () => {
    const path = `${DOCS}/handbook-v2/Everyday Types.md`
    expect(readFileSync(`${fixtureRoot}${path}`, 'utf8')).toContain('\r\n')

    const text = JSON.stringify(allBlocks(await parse(path)))
    expect(text).not.toContain('\\r')
    expect(text).not.toContain('permalink:')
  })

  it('keeps twoslash code blocks byte-for-byte with their language', async () => {
    const blocks = allBlocks(await parse(`${DOCS}/handbook-v2/Everyday Types.md`))
    expect(blocks).toContainEqual({
      kind: 'code',
      lang: 'ts',
      code: [
        '// @errors: 2345',
        'declare function greet(name: string): void;',
        '// ---cut---',
        '// Would be a runtime error if executed!',
        'greet(42);',
      ].join('\n'),
    })
  })

  it('drops sections hidden in HTML comments', async () => {
    const doc = await parse(`${DOCS}/release-notes/TypeScript 5.0.md`)
    const headings = doc.sections.flatMap((section) => section.headingPath)
    expect(headings).not.toContain('Improved Type Argument Inference')
    expect(JSON.stringify(allBlocks(doc))).not.toContain('<!--')
  })

  it('turns HTML into text and drops HTML that has none', async () => {
    const blocks = allBlocks(await parse(`${DOCS}/handbook-v2/Everyday Types.md`))
    const prose = blocks.flatMap((block) => (block.kind === 'prose' ? [block.text] : []))
    expect(prose.some((text) => text.includes('Extending an interface'))).toBe(true)
    expect(prose.some((text) => /<\/?(table|tr|td|div)\b/.test(text))).toBe(false)
  })

  it('keeps HTML table rows readable: one row per line, cells joined by " | "', async () => {
    const blocks = allBlocks(await parse(`${DOCS}/project-config/Compiler Options.md`))
    const prose = blocks.flatMap((block) => (block.kind === 'prose' ? [block.text] : []))

    expect(prose).toContain('Flag | Type\n`--all` | `boolean`\nShow all compiler options.')
    expect(prose).toContain('`--help` | `boolean`\nGives local information for help on the CLI.')
    expect(prose.some((text) => /<\/?(table|tr|td|th|p)\b/.test(text))).toBe(false)
  })

  it('records metadata: release version, error codes, option name and summary', async () => {
    expect((await parse(`${DOCS}/release-notes/TypeScript 5.0.md`)).metadata).toMatchObject({
      version_introduced: '5.0',
    })
    expect((await parse(`${DOCS}/handbook-v2/Everyday Types.md`)).metadata).toMatchObject({
      oneline: 'The language primitives.',
      error_codes: expect.arrayContaining([2322, 2345]) as unknown,
    })
    const strict = await parse(`${OPTIONS}/strict.md`)
    expect(strict.metadata).toEqual({
      oneline: 'Enable all strict type-checking options.',
      option: 'strict',
      display: 'Strict',
    })
    expect(allBlocks(strict)[0]).toEqual({
      kind: 'prose',
      text: 'Enable all strict type-checking options.',
    })
  })

  it('fails a documentation page without a permalink', async () => {
    await expect(
      source.parse(
        { path: `${DOCS}/reference/X.md`, content: '---\ntitle: X\n---\n\nText.\n' },
        { commitSha: undefined },
      ),
    ).rejects.toThrow('frontmatter has no absolute permalink')
  })
})

describe('matchPath', () => {
  it.each([
    [`${DOCS}/handbook-v2/Basics.md`, true],
    [`${DOCS}/modules-reference/appendices/ESM-CJS-Interop.md`, true],
    [`${DOCS}/declaration-files/templates/module.d.ts.md`, true],
    [`${OPTIONS}/typeAcquisition/exclude.md`, true],
    [`${DOCS}/modules-reference/diagrams/theory.md`, false],
    [`${DOCS}/modules-reference/diagrams/theory.md-1.svg`, false],
    [`${DOCS}/handbook-v1/Basic Types.md`, false],
    [`${DOCS}/tutorials/React.md`, false],
    [`${DOCS}/get-started/TS for JS Programmers.md`, false],
    [`${DOCS}/Nightly Builds.md`, false],
  ])('%s -> %s', (path, expected) => {
    expect(matchPath(path)).toBe(expected)
  })
})

describe('errorCodesOf', () => {
  it('collects codes from @errors directives, unique and sorted', () => {
    expect(
      errorCodesOf(['// @errors: 2345 2322\nfoo()', '  // @errors: 2322, 7006', '// no']),
    ).toEqual([2322, 2345, 7006])
  })

  it('reads codes from the directive line only, not from a number on the next line', () => {
    expect(errorCodesOf(['// @errors: 2345\n42\nfoo()'])).toEqual([2345])
  })
})

describe('exactTokensOf', () => {
  it('adds the bare number for an error code, the way @errors directives write it', () => {
    expect(exactTokensOf('What does error TS2345 mean?')).toEqual(['TS2345', '2345'])
    expect(exactTokensOf('ts2322 or TS18048: and TS2322 again')).toEqual([
      'TS2322',
      '2322',
      'TS18048',
      '18048',
    ])
  })

  it('ignores numbers that are not error codes', () => {
    expect(exactTokensOf('TypeScript 5.0 and TS 2345 and XTS2345 and TS123')).toEqual([])
  })

  it('is the source hook, next to the parser version', () => {
    expect(source.exactTokens?.('TS2345')).toEqual(['TS2345', '2345'])
    expect(source.parserVersion).toBe(PARSER_VERSION)
  })
})
