import { describe, expect, it } from 'vitest'

import { satisfiesHowFixture, varianceFixture } from '../fixtures.ts'
import { excerptPreview, PREVIEW_CHARACTERS, PREVIEW_LINES } from './excerpt.ts'

describe('excerptPreview', () => {
  it('shows a short excerpt whole', () => {
    expect(excerptPreview('One line.')).toBeUndefined()
    expect(excerptPreview('a\nb\nc\nd\ne')).toBeUndefined()
  })

  it('cuts a long excerpt at a line boundary', () => {
    const preview = excerptPreview('a\nb\nc\nd\ne\nf\ng')
    expect(preview).toBe('a\nb\nc\nd\ne')
    expect(preview?.split('\n')).toHaveLength(PREVIEW_LINES)
  })

  it('closes a code block it cuts through, so the rest still renders as code', () => {
    const preview = excerptPreview(
      'Example:\n```ts\nconst a = 1\nconst b = 2\nconst c = 3\nconst d = 4',
    )
    expect(preview).toBe('Example:\n```ts\nconst a = 1\nconst b = 2\nconst c = 3\n```')
  })

  it('leaves a code block alone when the cut comes after it', () => {
    const text = '```\na\n```\n\nThen text.\nMore text.\nAnd more.'
    expect(excerptPreview(text)).toBe('```\na\n```\n\nThen text.\nMore text.')
  })

  it('cuts one long line at a word, closing an open code span', () => {
    const line = `Use \`${'x'.repeat(PREVIEW_CHARACTERS - 20)} and\` more ${'y '.repeat(200)}`
    const preview = excerptPreview(line)
    expect(preview?.length).toBeLessThanOrEqual(PREVIEW_CHARACTERS + 4)
    expect(preview?.endsWith('...')).toBe(true)
    expect((preview?.match(/`/g)?.length ?? 0) % 2).toBe(0)
  })

  it('keeps going past a heading or a short lead line, so a preview shows text', () => {
    const long = `A sentence that goes on ${'and on '.repeat(60)}`
    const preview = excerptPreview(`### any\n\n${long}`)
    expect(preview?.startsWith('### any\n\nA sentence that goes on')).toBe(true)
    expect(preview?.endsWith('...')).toBe(true)
    expect(preview?.length).toBeLessThanOrEqual(PREVIEW_CHARACTERS + 3)
  })

  it('leaves out a long line when there is little room for it', () => {
    const lead = 'x'.repeat(PREVIEW_CHARACTERS - 20)
    expect(excerptPreview(`${lead}\n${'y '.repeat(100)}`)).toBe(lead)
  })

  it('does not count blank lines, so headings and their gaps leave room for text', () => {
    expect(excerptPreview('## A\n\n### B\n\n```sh\nnpm i\nmore\nand more\n```')).toBe(
      '## A\n\n### B\n\n```sh\nnpm i\nmore\n```',
    )
  })

  it('never ends on an opening fence, which would be an empty code box', () => {
    expect(excerptPreview('One\nTwo\nThree\nFour\n\n```sh\nnpm i')).toBe('One\nTwo\nThree\nFour')
    const long = 'x'.repeat(PREVIEW_CHARACTERS)
    expect(excerptPreview(`Install:\n\n\`\`\`sh\n${long}\n\`\`\``)).toBe(
      `Install:\n\n\`\`\`sh\n${long.slice(0, PREVIEW_CHARACTERS - 16)}...\n\`\`\``,
    )
  })

  it('closes a code block with the indent it opened with, so a list stays whole', () => {
    expect(excerptPreview('- Item:\n\n  ```ts\n  a\n  b\n  c\n  d\n  ```')).toBe(
      '- Item:\n\n  ```ts\n  a\n  b\n  c\n  ```',
    )
  })

  it('takes a 3-tick line in a 4-tick block for code', () => {
    const preview = excerptPreview('````md\n```\na\n```\nb\nc\nd\n````')
    expect(preview).toBe('````md\n```\na\n```\nb\n````')
  })

  it('backs up to before a link or emphasis the cut would leave open', () => {
    const pad = 'word '.repeat(48)
    const link = excerptPreview(
      `${pad}You can [try it yourself in the playground](https://a.b/c) now`,
    )
    expect(link).toBe(`${pad}You can...`)
    const bold = excerptPreview(`${pad}You **should not read this bold text whole** now`)
    expect(bold).toBe(`${pad}You...`)
    const emphasis = excerptPreview(`${pad}You *should not read this emphasis whole* now`)
    expect(emphasis).toBe(`${pad}You...`)
    // Bold around a code span is still open.
    const code = excerptPreview(
      `${pad}You **\`read\` this bold text that goes on and on whole** now`,
    )
    expect(code).toBe(`${pad}You...`)
    // At the very start there is nothing to back up to, so the opening goes.
    const start = excerptPreview(`[${'long words '.repeat(30)}](https://a.b/c)`)
    expect(start?.startsWith('long words')).toBe(true)
    expect(start).not.toContain('[')
  })

  it('leaves what is closed alone, and what only looks like markup in code', () => {
    const pad = 'word '.repeat(30)
    const tail = 'and more '.repeat(30)
    const closed = excerptPreview(`${pad}a [link](https://a.b) and **bold** ${tail}`)
    expect(closed).toContain('[link](https://a.b) and **bold**')
    const code = excerptPreview(`${pad}Use \`a[0]\` and \`*b\` ${tail}`)
    expect(code).toContain('`a[0]` and `*b`')
    const snake = excerptPreview(`${pad}Use snake_case and 2 * 3 ${tail}`)
    expect(snake).toContain('Use snake_case and 2 * 3')
  })

  it('does not offer more when there is nothing more, trailing space included', () => {
    expect(excerptPreview(`${'x'.repeat(258)}\n\n\n`)).toBeUndefined()
    expect(excerptPreview('a\nb\nc\nd\ne\n\n')).toBeUndefined()
  })

  it('previews the recorded excerpts: the ts fence stays one closed block', () => {
    const fenced = satisfiesHowFixture.citations.find((c) => c.citedText.includes('```'))
    const preview = excerptPreview(fenced?.citedText ?? '')
    expect((preview?.match(/```/g)?.length ?? 0) % 2).toBe(0)

    const long = varianceFixture.citations.map((c) => excerptPreview(c.citedText))
    expect(long.some((p) => p !== undefined)).toBe(true)
  })
})
