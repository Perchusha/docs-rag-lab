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
      'aria-label="Source 1: TypeScript 5.0 &gt; @satisfies Support in JSDoc. Show it in the inspector"',
    )
    expect(out).not.toContain('#cite-1')
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

  it('shows a marker with no known citation as plain text', () => {
    const out = html('Claim[7](#cite-7)')
    expect(out).toMatch(/Claim<span[^>]*>\[7\]<\/span>/)
    expect(out).not.toContain('<button')
  })
})
