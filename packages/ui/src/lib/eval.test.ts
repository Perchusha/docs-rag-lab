import { describe, expect, it } from 'vitest'

import {
  figurePosition,
  figureWords,
  percentRange,
  runToRunWords,
  shapeFor,
  splitWords,
  staleWords,
  verdictWords,
} from './eval.ts'

describe('figureWords', () => {
  it('keeps a share and its interval together', () => {
    expect(figureWords({ kind: 'share', count: 36, of: 40, low: 0.772, high: 0.96 })).toBe(
      '36 of 40 (77-96%)',
    )
  })

  it('keeps a mean and its interval together, with no tilde', () => {
    expect(figureWords({ kind: 'mean', value: 0.7508, of: 40, low: 0.639, high: 0.866 })).toBe(
      '0.751 (0.64-0.87)',
    )
  })

  it('says why there is no number', () => {
    expect(figureWords({ kind: 'none', reason: 'cannot: no docs' })).toBe('cannot: no docs')
  })

  it('leaves text as it is', () => {
    expect(figureWords({ kind: 'text', text: '4.2 s' })).toBe('4.2 s')
  })
})

describe('percentRange', () => {
  it('rounds both ends', () => {
    expect(percentRange(0.566, 1)).toBe('57-100%')
  })
})

describe('figurePosition', () => {
  it('places a share at its count, and its whiskers at the interval', () => {
    expect(figurePosition({ kind: 'share', count: 1, of: 4, low: 0.1, high: 0.6 })).toEqual({
      value: 0.25,
      low: 0.1,
      high: 0.6,
    })
  })

  it('places a mean at its value', () => {
    expect(figurePosition({ kind: 'mean', value: 0.5, of: 4, low: 0.1, high: 0.6 })?.value).toBe(
      0.5,
    )
  })

  it('has no place for what is not a number, or a share of nothing', () => {
    expect(figurePosition({ kind: 'none', reason: 'x' })).toBeNull()
    expect(figurePosition({ kind: 'text', text: 'x' })).toBeNull()
    expect(figurePosition({ kind: 'share', count: 0, of: 0, low: 0, high: 1 })?.value).toBe(0)
  })
})

describe('shapeFor', () => {
  it('keeps one shape per column across sections, whatever the position', () => {
    expect(shapeFor('Vector', 0)).toBe(shapeFor('Vector', 1))
    expect(shapeFor('Hybrid', 1)).not.toBe(shapeFor('Vector', 0))
    expect(shapeFor('No RAG', 0)).not.toBe(shapeFor('Vector', 1))
  })

  it('tells other columns apart by position', () => {
    expect(shapeFor('before', 0)).not.toBe(shapeFor('after', 1))
  })
})

describe('verdictWords', () => {
  const split = { a: 'Vector', b: 'Hybrid' }

  it.each([
    ['a', 'Vector better'],
    ['b', 'Hybrid better'],
    ['noise', 'Noise'],
    ['not-significant', 'Not significant'],
    ['mixed', 'Mixed'],
    ['too-few', 'Too few to say'],
  ] as const)('says %s', (verdict, words) => {
    expect(verdictWords({ ...split, verdict })).toBe(words)
  })
})

describe('splitWords', () => {
  const split = {
    a: 'Vector',
    b: 'Hybrid',
    aAhead: 14,
    bAhead: 7,
    tied: 19,
    p: 0.1892,
    verdict: 'not-significant',
  } as const

  it('keeps each side with its own count', () => {
    expect(splitWords(split)).toBe('Vector 14, Hybrid 7, tied 19, p = 0.19')
  })

  it('does not round a small p to zero', () => {
    expect(splitWords({ ...split, p: 0.004 })).toContain('p < 0.01')
  })
})

describe('runToRunWords', () => {
  it.each([
    [null, 'not measured'],
    [0, 'none'],
    [1, '1 question differs'],
    [5, '5 questions differ'],
  ])('says %s as "%s"', (questions, words) => {
    expect(runToRunWords(questions)).toBe(words)
  })
})

describe('staleWords', () => {
  it.each([
    [0, 0, '0 questions stale'],
    [1, 0, '1 question stale'],
    [2, 3, '2 questions stale, 3 to re-read'],
  ])('says %i and %i as "%s"', (stale, review, words) => {
    expect(staleWords(stale, review)).toBe(words)
  })
})
