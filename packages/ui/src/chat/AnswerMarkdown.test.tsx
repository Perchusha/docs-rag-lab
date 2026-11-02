// Markdown safety (ADR-0008), checked on the server-rendered HTML.
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { answerFixture, tableAnswerFixture } from '../fixtures.ts'
import { answerMarkdown } from '../lib/answer.ts'
import { AnswerMarkdown } from './AnswerMarkdown.tsx'

function html(markdown: string): string {
  return renderToStaticMarkup(
    <AnswerMarkdown markdown={markdown} citations={answerFixture.citations} />,
  )
}

describe('AnswerMarkdown', () => {
  it('shows raw HTML as text, never as elements', () => {
    const out = html('Hi <img src=x onerror="alert(1)"> <script>alert(2)</script>')
    expect(out).not.toMatch(/<img|<script/i)
    expect(out).not.toContain('onerror="alert')
  })

  it('drops javascript: URLs and renders only http(s) links as links', () => {
    const out = html('[a](javascript:alert(1)) [b](/relative) [c](https://example.com/x)')
    expect(out).not.toContain('javascript:')
    expect(out).not.toContain('href="/relative"')
    expect(out.match(/<a /g)).toHaveLength(1)
  })

  it('opens web links in a new tab with rel="noopener noreferrer"', () => {
    const out = html('See [the handbook](https://www.typescriptlang.org/docs/).')
    expect(out).toContain('href="https://www.typescriptlang.org/docs/"')
    expect(out).toContain('target="_blank"')
    expect(out).toContain('rel="noopener noreferrer"')
    expect(out).toContain('(opens in a new tab)')
  })

  it('renders images as their alt text, so nothing loads from elsewhere', () => {
    const out = html('![a diagram](https://example.com/track.png)')
    expect(out).not.toContain('<img')
    expect(out).toContain('a diagram')
  })

  it('turns citation markers into buttons named after their source', () => {
    const out = html(answerMarkdown(answerFixture.parts))
    expect(out.match(/<button/g)).toHaveLength(2)
    expect(out).toContain(
      'aria-label="Source 1: TypeScript 5.0 &gt; @satisfies Support in JSDoc (part 1 of 2). Show it in the inspector"',
    )
    expect(out).not.toContain('#cite-1')
  })

  it('renders a citation after a code block on the text before it, not as a lone marker', () => {
    const out = html(
      answerMarkdown([
        { kind: 'text', text: 'Pass this:\n\n```sh\n--strict\n```' },
        { kind: 'cite', numbers: [1] },
      ]),
    )
    expect(out).toMatch(/<p>Pass this:<button[^>]*>1<\/button><\/p>/)
    expect(out).not.toMatch(/<p><button/)
  })

  it('keeps the text after a cited code block out of the code', () => {
    const out = html(
      answerMarkdown([
        { kind: 'text', text: '```ts\nconst a = 1 satisfies number\n```' },
        { kind: 'cite', numbers: [1] },
        { kind: 'text', text: '\n\nAfter the code.' },
      ]),
    )
    expect(out).toContain('<button')
    expect(out).toContain('<p>After the code.</p>')
    expect(out).not.toContain('#cite-1')
  })

  it('renders the headings of a quoted excerpt as bold text, not as headings of the page', () => {
    const out = renderToStaticMarkup(<AnswerMarkdown markdown={'## A heading\n\nText.'} quoted />)
    expect(out).toContain('<p><strong>A heading</strong></p>')
    expect(out).not.toContain('<h2')
    expect(html('## A heading')).toContain('<h2>A heading</h2>')
  })

  describe('GFM', () => {
    const table = '| | `any` | `unknown` |\n|---|---|---|\n| Safety | Unsafe. | Type-safe. |'

    it('renders a table in a focusable box named after its columns', () => {
      const out = html(table)
      expect(out).toMatch(/<div role="group" aria-label="Table: any, unknown" tabindex="0"[^>]*>/)
      expect(out).toContain('<table>')
      expect(out).toContain('<th><code>any</code></th>')
      expect(out).toContain('<td>Type-safe.</td>')
    })

    it('renders an empty corner header as a plain cell, and keeps column alignment', () => {
      const out = html(table)
      expect(out).toContain('<thead><tr><td></td><th>')
      expect(html('| a |\n|:-:|\n| b |')).toContain('<th style="text-align:center">a</th>')
    })

    it('names a table with no header text just "Table"', () => {
      expect(html('| |\n|---|\n| a |')).toContain('aria-label="Table"')
    })

    it('renders a code block in a focusable box of its own', () => {
      const out = html('```ts\nconst a = 1\n```')
      expect(out).toMatch(/<div role="group" aria-label="Code example" tabindex="0"[^>]*><pre>/)
    })

    it('keeps citations from the recorded answer inside its table cells', () => {
      const out = renderToStaticMarkup(
        <AnswerMarkdown
          markdown={answerMarkdown(tableAnswerFixture.parts)}
          citations={tableAnswerFixture.citations}
        />,
      )
      const cells = out.match(/<td>.*?<\/td>/gs) ?? []
      expect(cells.filter((cell) => cell.includes('<button')).length).toBeGreaterThan(4)
      expect(out).not.toContain('#cite-')
      expect(out.match(/<table>/g)).toHaveLength(1)
      expect(out.match(/aria-label="Code example"/g)).toHaveLength(2)
    })

    it('keeps a citation that follows the last pipe of a row, instead of losing it as an extra cell', () => {
      const out = html(
        answerMarkdown([
          { kind: 'text', text: '| a | b |\n|---|---|\n| c | d |' },
          { kind: 'cite', numbers: [1] },
        ]),
      )
      expect(out).toMatch(/<td>d<button[^>]*>1<\/button><\/td>/)
    })

    it('keeps the safety rules inside a table cell', () => {
      const out = html(
        '| a |\n|---|\n| <img src=x onerror="alert(1)"> [b](javascript:alert(1)) www.example.com |',
      )
      expect(out).not.toMatch(/<img/i)
      expect(out).not.toContain('javascript:')
      expect(out).toContain('rel="noopener noreferrer"')
    })

    it('renders task lists as text, so an answer adds no form controls', () => {
      const out = html('- [x] done\n- [ ] open')
      expect(out).not.toContain('<input')
      expect(out).toContain('[x] ')
      expect(out).toContain('[ ] ')
    })

    it('strikes through with two tildes only, so version ranges stay intact', () => {
      expect(html('Use ~5.0 or ~5.1 and ~6.0~ here')).not.toContain('<del>')
      expect(html('~~old~~')).toContain('<del>old</del>')
    })
  })

  describe('a citation that ends on a code block', () => {
    const shapes: Record<string, string> = {
      'a plain block': 'Intro.\n\n```ts\nconst a = 1\n```',
      'a 3-tick block holding a line with an info string': 'Intro.\n\n```\n```ts\nconst a = 1\n```',
      'a 4-tick block holding one 3-tick line': 'Intro.\n\n````\n```\nconst a = 1\n````',
      'a 4-tick block holding a closed 3-tick block': 'Intro.\n\n````\n```\nconst a = 1\n```\n````',
      'a tilde block holding a backtick line': 'Intro.\n\n~~~\n```\nconst a = 1\n~~~',
      'inline code at the start of a line, then a block':
        'Intro.\n\n```x``` is inline.\n\n```\nconst a = 1\n```',
      'a block in a nested list': '- One\n  - Two\n\n    ```ts\n    const a = 1\n    ```',
      'a block on a list marker line': '1. ```ts\n   const a = 1\n   ```',
      'a block in a quote': 'Intro.\n\n> ```ts\n> const a = 1\n> ```',
      'a heading underline before the block': 'Title\n---\n```\nconst a = 1\n```',
      'a rule before the block': 'Intro.\n\n---\n\n```\nconst a = 1\n```',
      'a block still open': 'Intro.\n\n```ts\nconst a = 1',
      'a quote that ends its block': 'Intro.\n\n> ```ts\n> const a = 1\n\nCited text.',
      'a list item that ends its block': '1. ```ts\n   const a = 1\n\nCited text.',
      'a closer indented as code': 'Intro.\n\n```\nconst a = 1\n    ```\nStill code.',
    }

    // A block still open takes all the text after it, so nothing can follow it here.
    const stillOpen = (text: string) => text.endsWith('const a = 1') || text.endsWith('Still code.')

    it.each(Object.entries(shapes))('%s: the marker renders, and code stays code', (_, text) => {
      const out = html(
        answerMarkdown([
          { kind: 'text', text },
          { kind: 'cite', numbers: [1] },
          ...(stillOpen(text) ? [] : [{ kind: 'text' as const, text: '\n\nAfter it.' }]),
        ]),
      )
      expect(out.match(/<button/g)).toHaveLength(1)
      expect(out).not.toContain('#cite-1')
      expect(out).toMatch(/<pre>/)
      // The code holds no marker, and the text after it is not code.
      const code = out.match(/<pre>[\s\S]*?<\/pre>/g)?.join('') ?? ''
      expect(code).not.toContain('<button')
      expect(code).not.toContain('After it.')
      expect(out.replace(/<pre>[\s\S]*?<\/pre>/g, '')).toMatch(
        stillOpen(text) ? /<button/ : /After it\./,
      )
    })

    it('keeps a marker on the text after a block that a quote or a list item ended', () => {
      const parts = (text: string) => [
        { kind: 'text' as const, text },
        { kind: 'cite' as const, numbers: [1] },
      ]
      const quote = html(answerMarkdown(parts('Intro.\n\n> ```ts\n> a\n\nCited text.')))
      expect(quote).toMatch(/Cited text\.<button/)
      const item = html(answerMarkdown(parts('1. ```ts\n   a\n\nCited text.')))
      expect(item).toMatch(/Cited text\.<button/)
    })

    it('renders a citation after an exclamation mark or a backslash', () => {
      const parts = (text: string) => [
        { kind: 'text' as const, text },
        { kind: 'cite' as const, numbers: [1] },
      ]
      const great = html(answerMarkdown(parts('This is great!')))
      expect(great).toMatch(/This is great!<button/)
      expect(great).not.toContain('<span>1')
      const path = html(answerMarkdown(parts('A path C:\\')))
      expect(path).toMatch(/A path C:\\<button/)
    })

    it('keeps a heading a heading, and a rule a rule', () => {
      const parts = (text: string) => [
        { kind: 'text' as const, text },
        { kind: 'cite' as const, numbers: [1] },
      ]
      expect(
        html(answerMarkdown(parts(shapes['a heading underline before the block'] ?? ''))),
      ).toMatch(/<h2>Title<button/)
      expect(html(answerMarkdown(parts(shapes['a rule before the block'] ?? '')))).toContain('<hr')
    })
  })

  it('shows a marker with no known citation as plain text', () => {
    const out = html('Claim[7](#cite-7)')
    expect(out).toMatch(/Claim<span[^>]*>\[7\]<\/span>/)
    expect(out).not.toContain('<button')
  })
})
