import { describe, expect, it } from 'vitest'

import { answerFixture } from '../fixtures.ts'
import {
  chunkLocation,
  chunkTitle,
  formatMs,
  formatRrf,
  formatScore,
  formatUsage,
} from './format.ts'

describe('format', () => {
  it('formats times and scores', () => {
    expect(formatMs(0.4754)).toBe('0.5 ms')
    expect(formatMs(12.6)).toBe('13 ms')
    expect(formatMs(1459.2)).toBe('1,459 ms')
    expect(formatScore('cosine-distance', 0.41237)).toBe('0.412')
    expect(formatScore('bm25', 12.3456)).toBe('12.35')
    expect(formatRrf(1 / 61 + 1 / 62)).toBe('0.0325')
  })

  it('names a chunk by its title and the section it starts in, and shortens its path', () => {
    const chunk = {
      title: 'TypeScript 4.9',
      sectionPath: ['The satisfies Operator'],
      docPath: 'packages/documentation/copy/en/release-notes/TypeScript 4.9.md',
      anchor: 'the-satisfies-operator',
    }
    expect(chunkTitle(chunk)).toBe('TypeScript 4.9 > The satisfies Operator')
    expect(chunkLocation(chunk)).toBe('release-notes/TypeScript 4.9.md#the-satisfies-operator')
    expect(chunkLocation({ ...chunk, anchor: '' })).toBe('release-notes/TypeScript 4.9.md')
    // No source's folder layout is built in: a react.dev path shortens the same way.
    expect(
      chunkLocation({ docPath: 'src/content/reference/react/useState.md', anchor: 'usage' }),
    ).toBe('react/useState.md#usage')
  })

  it('formats the recorded usage', () => {
    expect(formatUsage(answerFixture.usage)).toBe(
      'voyage-4 0 tokens, 1 cached; claude-sonnet-5-5 7,927 in, 124 out. About $0.0171 at list prices checked 2026-10-31.',
    )
  })
})
