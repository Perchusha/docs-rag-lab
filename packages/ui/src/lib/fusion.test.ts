import { describe, expect, it } from 'vitest'

import { traces } from '../fixtures.ts'
import {
  doubleCounting,
  doubledTokens,
  fusionRows,
  maxRrfScore,
  sortRows,
  type FusionRow,
} from './fusion.ts'

const rows = fusionRows(traces.satisfies)

function row(fusedRank: number): FusionRow {
  const found = rows.find((r) => r.fusedRank === fusedRank)
  if (found === undefined) throw new Error(`no row ${String(fusedRank)}`)
  return found
}

describe('fusionRows on the satisfies trace', () => {
  it('has one row per fused candidate, best first', () => {
    const { fusion } = traces.satisfies
    expect(fusion.method).toBe('rrf')
    expect(rows).toHaveLength(fusion.method === 'rrf' ? fusion.ranked.length : 0)
    expect(rows.map((r) => r.fusedRank)).toEqual(rows.map((_, i) => i + 1))
    expect(rows.filter((r) => r.inContext)).toHaveLength(8)
  })

  it('shows the M2 regression: the vector top hit falls to 3', () => {
    const third = row(3)
    expect(third.chunk?.sectionPath).toEqual(['The satisfies Operator'])
    expect(third.cells.vector?.rank).toBe(1)
    expect(third.delta).toBe(-2)
    expect(row(1).delta).toBe(1)
    expect(row(6).delta).toBe('new')
  })

  it("adds up each list's contribution to the RRF score", () => {
    for (const r of rows) {
      const sum = Object.values(r.cells).reduce((total, cell) => total + cell.contribution, 0)
      expect(sum).toBeCloseTo(r.rrfScore, 12)
    }
    expect(row(1).cells.keyword?.contribution).toBeCloseTo(1 / 61, 12)
  })

  it("takes each list's own score from the trace", () => {
    const first = row(1)
    const vector = traces.satisfies.lists.find((l) => l.name === 'vector')
    const score = vector?.candidates.find((c) => c.chunkId === first.chunkId)?.score
    expect(first.cells.vector?.score).toBe(score)
  })

  it('marks the chunks that BM25 counts twice', () => {
    expect(rows.slice(0, 6).map((r) => r.bm25Twice)).toEqual([true, true, true, true, true, true])
    expect(row(7).bm25Twice).toBe(false)
    expect(doubledTokens(traces.satisfies)).toEqual(['satisfies'])
    expect(doubleCounting(traces.satisfies, rows)).toEqual({
      tokens: ['satisfies'],
      inContext: 6,
      topK: 8,
    })
  })

  it('draws contribution bars against first place in every list that ran', () => {
    expect(maxRrfScore(traces.satisfies)).toBeCloseTo(3 / 61, 12)
  })
})

describe('the other traces', () => {
  it('TS2345: the source hook adds the code and its number, and both are terms too', () => {
    expect(doubledTokens(traces.ts2345)).toEqual(['TS2345', '2345'])
  })

  it('a vector-only trace has no fusion rows', () => {
    expect(fusionRows(traces.satisfiesVector)).toEqual([])
    expect(doubleCounting(traces.satisfiesVector, [])).toBeUndefined()
  })
})

describe('sortRows', () => {
  it('sorts by a list rank, with chunks missing from that list last in either direction', () => {
    const byExact = sortRows(rows, 'exact', 'ascending')
    const exactRanks = byExact.map((r) => r.cells.exact?.rank)
    const present = exactRanks.filter((rank) => rank !== undefined)
    expect(present).toEqual([...present].sort((a, b) => a - b))
    expect(exactRanks.slice(present.length).every((rank) => rank === undefined)).toBe(true)

    const descending = sortRows(rows, 'exact', 'descending').map((r) => r.cells.exact?.rank)
    expect(descending.slice(0, present.length)).toEqual([...present].reverse())
    expect(descending.slice(present.length).every((rank) => rank === undefined)).toBe(true)
  })

  it('sorts by vector rank, so the vector top hit comes first', () => {
    expect(sortRows(rows, 'vector', 'ascending')[0]?.fusedRank).toBe(3)
    expect(sortRows(rows, 'fused', 'descending')[0]?.fusedRank).toBe(rows.length)
  })

  it('does not change the input', () => {
    const before = rows.map((r) => r.chunkId)
    sortRows(rows, 'keyword', 'descending')
    expect(rows.map((r) => r.chunkId)).toEqual(before)
  })
})
