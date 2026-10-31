import { describe, expect, it } from 'vitest'

import { runSourceConformance } from './conformance.ts'
import type { Block, ParsedDoc, Section, Source, SourceFile } from './types.ts'

// A tiny markdown-ish parser: '# ' is the title, '## ' starts a section,
// ``` fences code. Good enough to exercise the suite.
function parseDemo(file: SourceFile): ParsedDoc {
  const lines = file.content.split('\n')
  const title = (lines[0] ?? '').replace(/^# /, '')
  const sections: Section[] = [{ headingPath: [], anchor: '', blocks: [] }]
  let fence: string[] | undefined
  let lang = ''
  for (const line of lines.slice(1)) {
    const current = sections[sections.length - 1]
    if (current === undefined) break
    if (fence !== undefined) {
      if (line.trim() === '```') {
        current.blocks.push({ kind: 'code', lang, code: fence.join('\n') })
        fence = undefined
      } else {
        fence.push(line.replace(/^ {2}/, ''))
      }
      continue
    }
    if (line.trim().startsWith('```')) {
      fence = []
      lang = line.trim().slice(3)
    } else if (line.startsWith('## ')) {
      const heading = line.slice(3)
      sections.push({ headingPath: [heading], anchor: heading.toLowerCase(), blocks: [] })
    } else if (line.trim() !== '') {
      current.blocks.push({ kind: 'prose', text: line })
    }
  }
  return {
    title,
    url: `https://docs.example.com/${file.path.replace(/\.md$/, '')}`,
    docType: 'handbook',
    sections,
    metadata: {},
  }
}

const demo = (overrides: Partial<Source> = {}): Source => ({
  id: 'demo',
  repo: 'https://example.com/demo.git',
  branch: 'main',
  include: ['docs'],
  license: { name: 'MIT', url: 'https://example.com', attribution: 'Demo' },
  parserVersion: 1,
  match: (path) => path.startsWith('docs/') && path.endsWith('.md'),
  parse: (file) => Promise.resolve(parseDemo(file)),
  ...overrides,
})

const files: SourceFile[] = [
  {
    path: 'docs/basics.md',
    content: '# Basics\nIntro text.\n## Types\nSome prose.\n```ts\nlet x: number = 1\n```\n',
  },
  {
    path: 'docs/lists.md',
    content: '# Lists\n## Indented\n- item\n  ```ts\n  const y = [1, 2]\n    .map(String)\n  ```\n',
  },
]

const urlPattern = /^https:\/\/docs\.example\.com\/docs\/[a-z]+$/

async function failuresOf(source: Source, fixtures = files): Promise<string[]> {
  return (await runSourceConformance(source, { files: fixtures, urlPattern })).failures
}

const mapDocs = (change: (doc: ParsedDoc) => ParsedDoc) => (file: SourceFile) =>
  Promise.resolve(change(parseDemo(file)))

describe('runSourceConformance', () => {
  it('passes a well-behaved source, including code inside list indentation', async () => {
    expect(await failuresOf(demo())).toEqual([])
  })

  it('fails when there are no fixtures', async () => {
    expect(await failuresOf(demo(), [])).toEqual(['no fixtures'])
  })

  it('fails a parser version that is not a positive integer', async () => {
    expect(await failuresOf(demo({ parserVersion: 0 }))).toEqual([
      'parserVersion must be a positive integer, got 0',
    ])
    expect(await failuresOf(demo({ parserVersion: 1.5 }))).toHaveLength(1)
  })

  it('fails a fixture that match() rejects', async () => {
    const failures = await failuresOf(demo({ match: (path) => path.endsWith('basics.md') }))
    expect(failures).toEqual(['docs/lists.md: source.match() rejects a fixture'])
  })

  it('fails a parse that throws', async () => {
    const failures = await failuresOf(demo({ parse: () => Promise.reject(new Error('boom')) }))
    expect(failures).toContain('docs/basics.md: parse threw: boom')
  })

  it('fails relative, non-https and non-matching URLs', async () => {
    const relative = await failuresOf(
      demo({ parse: mapDocs((doc) => ({ ...doc, url: '/docs/x' })) }),
    )
    expect(relative).toContain('docs/basics.md: url is not absolute: /docs/x')

    const http = await failuresOf(
      demo({ parse: mapDocs((doc) => ({ ...doc, url: doc.url.replace('https:', 'http:') })) }),
    )
    expect(http.some((failure) => failure.includes('url is not https'))).toBe(true)

    const elsewhere = await failuresOf(
      demo({ parse: mapDocs((doc) => ({ ...doc, url: 'https://elsewhere.example.com/x' })) }),
    )
    expect(elsewhere.some((failure) => failure.includes('url does not match'))).toBe(true)
  })

  it('fails an unknown docType and an anchor with spaces', async () => {
    const failures = await failuresOf(
      demo({
        parse: mapDocs((doc) => ({
          ...doc,
          docType: 'blog' as ParsedDoc['docType'],
          sections: doc.sections.map((s) => ({ ...s, anchor: s.anchor === '' ? '' : 'has space' })),
        })),
      }),
    )
    expect(failures).toContain('docs/basics.md: unknown docType: blog')
    expect(failures).toContain('docs/basics.md: invalid anchor: "has space"')
  })

  it('fails a source whose two parses differ', async () => {
    let calls = 0
    const failures = await failuresOf(
      demo({
        parse: mapDocs((doc) => ({ ...doc, title: `${doc.title} ${String(calls++)}` })),
      }),
    )
    expect(failures).toContain('docs/basics.md: two parses gave different chunks')
  })

  it('fails a document that produces no chunks', async () => {
    const failures = await failuresOf(demo({ parse: mapDocs((doc) => ({ ...doc, sections: [] })) }))
    expect(failures).toContain('docs/basics.md: produced no chunks')
  })

  it('fails code that is not a verbatim copy of the source', async () => {
    const trimmed = (blocks: Block[]): Block[] =>
      blocks.map((block) =>
        block.kind === 'code' ? { ...block, code: block.code.replace('1', 'one') } : block,
      )
    const failures = await failuresOf(
      demo({
        parse: mapDocs((doc) => ({
          ...doc,
          sections: doc.sections.map((s) => ({ ...s, blocks: trimmed(s.blocks) })),
        })),
      }),
    )
    expect(failures).toContain(
      'docs/basics.md: code block starting "let x: number = one" is not verbatim in the source',
    )
  })
})
