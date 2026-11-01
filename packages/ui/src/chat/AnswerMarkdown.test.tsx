// Markdown safety (ADR-0008), checked on the server-rendered HTML.
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { answerFixture } from '../fixtures.ts'
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

  it('shows a marker with no known citation as plain text', () => {
    const out = html('Claim[7](#cite-7)')
    expect(out).toMatch(/Claim<span[^>]*>\[7\]<\/span>/)
    expect(out).not.toContain('<button')
  })
})
