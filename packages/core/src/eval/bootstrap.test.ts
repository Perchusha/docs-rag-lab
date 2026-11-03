import { describe, expect, it } from 'vitest'

import { bootstrapMean, seeded } from './bootstrap.ts'

describe('seeded', () => {
  it('repeats for a seed, differs across seeds, and stays in 0 to 1', () => {
    const draw = (seed: number) => {
      const random = seeded(seed)
      return Array.from({ length: 100 }, () => random())
    }

    expect(draw(1)).toEqual(draw(1))
    expect(draw(1)).not.toEqual(draw(2))
    expect(draw(1).every((value) => value >= 0 && value < 1)).toBe(true)
  })
})

describe('bootstrapMean', () => {
  const skewed = [
    ...Array.from({ length: 30 }, () => 1),
    ...Array.from({ length: 6 }, () => 0.2),
    ...Array.from({ length: 4 }, () => 0),
  ]

  it('gives the mean of the values', () => {
    expect(bootstrapMean([0, 1, 1, 0]).value).toBe(0.5)
  })

  // Values with no ties, so that any change of resamples shows in the percentile.
  const spread = Array.from({ length: 40 }, (_, i) => Math.sqrt(i + 1) / 7)

  it('gives the same interval every time, which is what the fixed seed is for', () => {
    expect(bootstrapMean(spread)).toEqual(bootstrapMean(spread))
  })

  it('changes with the seed', () => {
    expect(bootstrapMean(spread).low).not.toBe(bootstrapMean(spread, { seed: 1 }).low)
  })

  it('holds the mean inside the interval', () => {
    const { value, low, high } = bootstrapMean(skewed)

    expect(low).toBeLessThan(value)
    expect(high).toBeGreaterThan(value)
  })

  it('never passes the range of the values, unlike a t-interval on this skew', () => {
    const nearlyAll = [...Array.from({ length: 39 }, () => 1), 0]
    const { high } = bootstrapMean(nearlyAll)
    const mean = 39 / 40
    const sd = Math.sqrt((39 * (1 - mean) ** 2 + mean ** 2) / 39)

    expect(mean + (2.023 * sd) / Math.sqrt(40)).toBeGreaterThan(1)
    expect(high).toBeLessThanOrEqual(1)
  })

  it('is close to the known spread of a mean', () => {
    const values = Array.from({ length: 400 }, (_, i) => (i % 2 === 0 ? 0 : 1))
    const { low, high } = bootstrapMean(values)

    // 1.96 * 0.5 / sqrt(400) = 0.049.
    expect(low).toBeCloseTo(0.451, 1)
    expect(high).toBeCloseTo(0.549, 1)
  })

  it('narrows as the questions grow', () => {
    const width = (n: number) => {
      const { low, high } = bootstrapMean(Array.from({ length: n }, (_, i) => i % 2))
      return high - low
    }

    expect(width(400)).toBeLessThan(width(40))
  })

  it('has nothing to say about no values', () => {
    expect(bootstrapMean([])).toEqual({ value: 0, low: 0, high: 0 })
  })

  it('takes a number of resamples', () => {
    expect(bootstrapMean([0, 1], { resamples: 10 }).value).toBe(0.5)
  })
})
