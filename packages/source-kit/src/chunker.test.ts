import { describe, expect, it } from 'vitest'

import {
  chunkDocument,
  chunkId,
  packBalanced,
  renderBlock,
  renderCompilerOutput,
} from './chunker.ts'
import { estimateTokens } from './tokens.ts'
import type { Block, CompilerOutput, ParsedDoc, Section } from './types.ts'

const prose = (text: string): Block => ({ kind: 'prose', text })
const code = (text: string, lang = 'ts'): Block => ({ kind: 'code', lang, code: text })
const section = (headingPath: string[], ...blocks: Block[]): Section => ({
  headingPath,
  anchor: (headingPath.at(-1) ?? '').toLowerCase().replaceAll(' ', '-'),
  blocks,
})
const doc = (...sections: Section[]): ParsedDoc => ({
  title: 'Doc',
  url: 'https://example.com/doc',
  docType: 'handbook',
  sections,
  metadata: {},
})
/** A prose block of about `tokens` estimated tokens. */
const words = (tokens: number, word = 'word'): Block =>
  prose(Array.from({ length: Math.ceil((tokens * 3.5) / (word.length + 1)) }, () => word).join(' '))

describe('chunkDocument', () => {
  it('keeps a small document in one chunk with nested headings and a title prefix', () => {
    const chunks = chunkDocument(
      'a.md',
      doc(
        section([], prose('Intro.')),
        section(['A'], prose('About A.')),
        section(['A', 'A1'], code('let a = 1')),
        section(['B'], prose('About B.')),
      ),
    )

    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toMatchObject({
      docPath: 'a.md',
      ordinal: 0,
      headingPath: [],
      anchor: '',
      blockTypes: ['prose', 'code'],
    })
    expect(chunks[0]?.text).toBe(
      'Doc\n\nIntro.\n\n## A\n\nAbout A.\n\n### A1\n\n```ts\nlet a = 1\n```\n\n## B\n\nAbout B.',
    )
  })

  it('splits a document that does not fit by heading, with heading-path prefixes', () => {
    const chunks = chunkDocument(
      'a.md',
      doc(
        section([], words(50)),
        section(['A'], words(60)),
        section(['A', 'A1'], words(60)),
        section(['B'], words(60)),
      ),
      { maxTokens: 140 },
    )

    // The root does not fit. Its intro, A's whole subtree and B each fill a
    // pack; a pack that is one whole section takes that section's identity.
    expect(chunks.map((chunk) => chunk.text.split('\n')[0])).toEqual(['Doc', 'Doc > A', 'Doc > B'])
    expect(chunks.map((chunk) => chunk.headingPath)).toEqual([[], ['A'], ['B']])
    expect(chunks.map((chunk) => chunk.anchor)).toEqual(['', 'a', 'b'])
    expect(chunks.map((chunk) => chunk.sectionPath)).toEqual([[], ['A'], ['B']])
    expect(chunks[1]?.text).toContain('### A1\n\n')
    for (const chunk of chunks) expect(chunk.tokenCount).toBeLessThanOrEqual(160)
  })

  it('recurses into a child that does not fit and prefixes its heading path', () => {
    const chunks = chunkDocument(
      'a.md',
      doc(
        section(['A'], words(30)),
        section(['A', 'A1'], words(90)),
        section(['A', 'A2'], words(90)),
      ),
      { maxTokens: 100 },
    )

    expect(chunks.map((chunk) => [chunk.headingPath, chunk.anchor])).toEqual([
      [['A'], 'a'],
      [['A', 'A1'], 'a1'],
      [['A', 'A2'], 'a2'],
    ])
    expect(chunks[1]?.text.startsWith('Doc > A > A1\n\n')).toBe(true)
  })

  it('never splits a code block, even when it is larger than the budget', () => {
    const big = Array.from({ length: 200 }, (_, i) => `const v${String(i)} = ${String(i)}`).join(
      '\n',
    )
    const chunks = chunkDocument('a.md', doc(section(['A'], words(20), code(big), words(20))), {
      maxTokens: 100,
    })

    const withCode = chunks.filter((chunk) => chunk.text.includes(big))
    expect(withCode).toHaveLength(1)
    expect(chunks.length).toBeGreaterThan(1)
  })

  it('fences code with more backticks than the code contains', () => {
    expect(renderBlock(code('const s = ```inner```', 'md'))).toBe(
      '````md\nconst s = ```inner```\n````',
    )
  })

  it('splits an oversized table at row boundaries and repeats its header', () => {
    const rows = Array.from(
      { length: 80 },
      (_, i) => `| opt${String(i)} | description of option ${String(i)} |`,
    )
    const table = ['| Option | Description |', '| --- | --- |', ...rows].join('\n')
    const chunks = chunkDocument('a.md', doc(section(['Options'], prose(table))), {
      maxTokens: 200,
    })

    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.text).toContain('| Option | Description |\n| --- | --- |')
    }
    const allRows = chunks.flatMap((chunk) =>
      chunk.text.split('\n').filter((line) => line.includes('| opt')),
    )
    expect(allRows).toEqual(rows)
  })

  it('never splits a code fence nested in an oversized prose block', () => {
    // The fence holds a line that looks like an opening fence, which must not close it.
    const fenced = [
      '  ```md',
      ...Array.from({ length: 20 }, (_, i) => `  call${String(i)}()`),
      '  ```ts',
      ...Array.from({ length: 20 }, (_, i) => `  more${String(i)}()`),
      '  ```',
    ]
    const list = [
      ...Array.from({ length: 30 }, (_, i) => `- item ${String(i)} with a few words`),
      '- an item with code:',
      '',
      ...fenced,
      ...Array.from({ length: 30 }, (_, i) => `- later ${String(i)} with a few words`),
    ].join('\n')
    const chunks = chunkDocument('a.md', doc(section(['List'], prose(list))), { maxTokens: 150 })

    expect(chunks.length).toBeGreaterThan(2)
    expect(chunks.filter((chunk) => chunk.text.includes(fenced.join('\n')))).toHaveLength(1)
  })

  it('gives sections with the same heading path different, stable IDs', () => {
    const parsed = doc(
      section(['Examples'], words(90)),
      section(['Examples', 'Example'], words(90)),
      section(['Examples', 'Example'], words(90)),
    )
    const first = chunkDocument('a.md', parsed, { maxTokens: 100 })
    const second = chunkDocument('a.md', parsed, { maxTokens: 100 })

    const ids = first.map((chunk) => chunk.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(second.map((chunk) => chunk.id)).toEqual(ids)
    expect(first[1]?.id).toBe(chunkId('a.md', ['Examples', 'Example'], 0, 0))
    expect(first[2]?.id).toBe(chunkId('a.md', ['Examples', 'Example'], 1, 0))
  })

  it('keeps other chunk IDs and hashes when one section changes', () => {
    const before = chunkDocument(
      'a.md',
      doc(section(['A'], words(90)), section(['B'], words(90))),
      { maxTokens: 100 },
    )
    const after = chunkDocument(
      'a.md',
      doc(section(['A'], words(90)), section(['B'], words(90, 'other'))),
      { maxTokens: 100 },
    )

    expect(after.map((chunk) => chunk.id)).toEqual(before.map((chunk) => chunk.id))
    expect(after[0]?.textHash).toBe(before[0]?.textHash)
    expect(after[1]?.textHash).not.toBe(before[1]?.textHash)
  })

  it('packs small sibling sections together under the parent heading path', () => {
    const chunks = chunkDocument(
      'a.md',
      doc(
        section(['A'], words(10)),
        section(['A', 'One'], words(40)),
        section(['A', 'Two'], words(40)),
        section(['A', 'Three'], words(40)),
        section(['A', 'Four'], words(40)),
      ),
      { maxTokens: 120 },
    )

    expect(chunks.map((chunk) => [chunk.headingPath, chunk.anchor])).toEqual([
      [['A'], 'a'],
      [['A'], 'three'],
    ])
    expect(chunks[1]?.text).toMatch(/^Doc > A\n\n### Three\n\n.*\n\n### Four\n\n/s)
    expect(chunks[1]?.id).toBe(chunkId('a.md', ['A'], 0, 1))
    // The second pack starts in Three, which its anchor points to.
    expect(chunks.map((chunk) => chunk.sectionPath)).toEqual([['A'], ['A', 'Three']])
  })

  it('records the section a chunk starts in, also for a pack under the document root', () => {
    const chunks = chunkDocument(
      'a.md',
      doc(
        section(['One'], words(40)),
        section(['Two'], words(40)),
        section(['Three'], words(40)),
        section(['Four'], words(40)),
      ),
      { maxTokens: 100 },
    )

    // Packs under the root have no heading path of their own.
    expect(chunks.map((chunk) => [chunk.headingPath, chunk.anchor, chunk.sectionPath])).toEqual([
      [[], 'one', ['One']],
      [[], 'three', ['Three']],
    ])
  })

  it('numbers the chunks that start in one section, and only those', () => {
    const chunks = chunkDocument(
      'a.md',
      doc(section(['Long'], words(90), words(90), words(90)), section(['Short'], words(30))),
      { maxTokens: 100 },
    )

    expect(chunks.map((chunk) => [chunk.sectionPath, chunk.part])).toEqual([
      [['Long'], { index: 1, total: 3 }],
      [['Long'], { index: 2, total: 3 }],
      [['Long'], { index: 3, total: 3 }],
      [['Short'], null],
    ])
  })

  it('counts two subsections with the same path as one label, since they read the same', () => {
    const chunks = chunkDocument(
      'a.md',
      doc(section(['A', 'Example'], words(90)), section(['A', 'Example'], words(90))),
      { maxTokens: 100 },
    )

    expect(chunks.map((chunk) => chunk.part)).toEqual([
      { index: 1, total: 2 },
      { index: 2, total: 2 },
    ])
  })

  describe('anchors', () => {
    it('lists every section a chunk contains, starting with its own', () => {
      const [chunk] = chunkDocument(
        'a.md',
        doc(
          section([], prose('Intro.')),
          section(['A'], prose('About A.')),
          section(['A', 'A1'], prose('About A1.')),
          section(['B'], prose('About B.')),
        ),
      )

      expect(chunk).toMatchObject({ anchor: '', anchors: ['a', 'a1', 'b'] })
    })

    it('starts with the section a pack starts in, and lists only what is in that pack', () => {
      const chunks = chunkDocument(
        'a.md',
        doc(section(['A'], words(500)), section(['B'], words(500)), section(['C'], words(100))),
      )

      expect(chunks.map((c) => c.anchors)).toEqual([['a'], ['b', 'c']])
    })

    it('gives every part of a split section that section', () => {
      const chunks = chunkDocument('a.md', doc(section(['Long'], words(700), words(700))))

      expect(chunks.map((c) => c.anchors)).toEqual([['long'], ['long']])
    })

    it('takes fragments from the parser, so duplicate headings stay apart', () => {
      const example = (anchor: string): Section => ({
        headingPath: ['Parent', 'Example'],
        anchor,
        blocks: [words(500)],
      })
      const chunks = chunkDocument('a.md', doc(example('example'), example('example-1')))

      expect(chunks.flatMap((c) => c.anchors)).toEqual(['example', 'example-1'])
    })

    it('does not take a heading-shaped line in code for a section', () => {
      const [chunk] = chunkDocument(
        'a.md',
        doc(section(['A'], code('# not a heading\n## Nor this', 'sh'))),
      )

      expect(chunk?.anchors).toEqual(['a'])
    })

    it('is empty for a document whose sections have no anchors', () => {
      const [chunk] = chunkDocument(
        'a.md',
        doc({ headingPath: ['No anchor'], anchor: '', blocks: [prose('Text.')] }),
      )

      expect(chunk?.anchors).toEqual([])
    })
  })

  it('drops sections that have a heading but no content', () => {
    const chunks = chunkDocument('a.md', doc(section(['Empty']), section(['Full'], words(90))), {
      maxTokens: 100,
    })

    expect(chunks).toHaveLength(1)
    expect(chunks[0]?.text).toContain('## Full')
  })

  it('produces no chunks for a document without content', () => {
    expect(chunkDocument('a.md', doc(section(['Only a heading'])))).toEqual([])
  })

  it('records spans of rendered blocks, joining each heading to the block after it', () => {
    const [chunk] = chunkDocument(
      'a.md',
      doc(section([], prose('Intro.')), section(['A'], code('x()'), prose('After.'))),
    )
    if (chunk === undefined) throw new Error('expected a chunk')

    expect(chunk.spans.map(([start, end]) => chunk.text.slice(start, end))).toEqual([
      'Intro.',
      '## A\n\n```ts\nx()\n```',
      'After.',
    ])
  })

  it('stays within the budget for typical sections', () => {
    const sections = Array.from({ length: 12 }, (_, i) =>
      section([`S${String(i)}`], words(100 + i * 10)),
    )
    const chunks = chunkDocument('a.md', doc(...sections), { maxTokens: 400 })

    for (const chunk of chunks) {
      expect(estimateTokens(chunk.text)).toBeLessThanOrEqual(420)
    }
  })
})

describe('the compiler output on a code block (ADR-0017)', () => {
  const output: CompilerOutput = {
    errors: [
      {
        code: 2345,
        line: 'handleRequest(req.url, req.method);',
        text: 'Argument of type \'string\' is not assignable to parameter of type \'"GET" | "POST"\'.',
      },
    ],
    queries: [{ target: 's', line: 'let s = "hello";', text: 'let s: string' }],
  }
  const compiled = (text: string, out: CompilerOutput = output): Block => ({
    kind: 'code',
    lang: 'ts',
    code: text,
    compiled: out,
  })

  it('follows the code, which stays byte for byte, with each error and query', () => {
    expect(renderBlock(compiled('// @errors: 2345\nhandleRequest(req.url, req.method);'))).toBe(
      [
        '```ts\n// @errors: 2345\nhandleRequest(req.url, req.method);\n```',
        [
          'Compiler output:',
          '- Error TS2345 on `handleRequest(req.url, req.method);`: Argument of type \'string\' is not assignable to parameter of type \'"GET" | "POST"\'.',
          '- Type of `s`: `let s: string`',
        ].join('\n'),
      ].join('\n\n'),
    )
  })

  it('shows an emitted file as a code block of its own, labelled with its name', () => {
    expect(
      renderCompilerOutput({
        errors: [],
        queries: [],
        emitted: { name: 'index.js', lang: 'js', code: 'var x = 1;' },
      }),
    ).toBe('Emitted index.js:\n\n```js\nvar x = 1;\n```')
  })

  it('indents a message of several lines, and quotes a line that has backticks', () => {
    expect(
      renderCompilerOutput({
        errors: [{ code: 2322, line: 'let s = `a`', text: 'Type mismatch.\n  Details.' }],
        queries: [],
      }),
    ).toBe('Compiler output:\n- Error TS2322 on `` let s = `a` ``: Type mismatch.\n    Details.')
  })

  it('adds nothing when the compiler said nothing, so the block renders as without a compile', () => {
    expect(renderBlock(compiled('let s = 1', { errors: [], queries: [] }))).toBe(
      renderBlock(code('let s = 1')),
    )
  })

  it('records the output on the chunk, also from code inside a callout, and not on others', () => {
    const chunks = chunkDocument(
      'a.md',
      doc(
        section(['A'], prose('Plain.'), compiled('one()')),
        section(['B'], { kind: 'callout', variant: 'Note', blocks: [compiled('two()')] }),
      ),
      { maxTokens: 60 },
    )

    expect(chunks.flatMap((chunk) => chunk.compiler ?? [])).toHaveLength(2)
    expect(
      chunks
        .filter((chunk) => chunk.text.includes('Compiler output:'))
        .map(({ compiler }) => compiler?.length),
    ).toEqual([1, 1])
    const plain = chunkDocument('a.md', doc(section(['A'], prose('Plain.'), code('one()'))))
    expect(plain[0]?.compiler).toBeUndefined()
    expect(Object.keys(plain[0] ?? {})).not.toContain('compiler')
  })
})

describe('packBalanced', () => {
  it('returns one group when everything fits', () => {
    expect(packBalanced([1, 2, 3], (n) => n, 10)).toEqual([[1, 2, 3]])
  })

  it('aims for equal groups instead of a tiny last one', () => {
    expect(packBalanced([4, 4, 4, 4, 4], (n) => n, 16)).toEqual([
      [4, 4, 4],
      [4, 4],
    ])
    expect(packBalanced([5, 5, 5, 5, 1], (n) => n, 15)).toEqual([
      [5, 5],
      [5, 5, 1],
    ])
  })

  it('gives an oversized item a group of its own', () => {
    expect(packBalanced([2, 30, 2], (n) => n, 10)).toEqual([[2], [30], [2]])
  })
})
