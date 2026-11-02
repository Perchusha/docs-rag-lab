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
    expect(excerptPreview(text)).toBe('```\na\n```\n\nThen text.')
  })

  it('cuts one long line at a word, closing an open code span', () => {
    const line = `Use \`${'x'.repeat(PREVIEW_CHARACTERS - 20)} and\` more ${'y '.repeat(200)}`
    const preview = excerptPreview(line)
    expect(preview?.length).toBeLessThanOrEqual(PREVIEW_CHARACTERS + 4)
    expect(preview?.endsWith('...')).toBe(true)
    expect((preview?.match(/`/g)?.length ?? 0) % 2).toBe(0)
  })

  it('previews the recorded excerpts: the ts fence stays one closed block', () => {
    const fenced = satisfiesHowFixture.citations.find((c) => c.citedText.includes('```'))
    const preview = excerptPreview(fenced?.citedText ?? '')
    expect((preview?.match(/```/g)?.length ?? 0) % 2).toBe(0)

    const long = varianceFixture.citations.map((c) => excerptPreview(c.citedText))
    expect(long.some((p) => p !== undefined)).toBe(true)
  })
})
