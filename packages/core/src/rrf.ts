// Reciprocal Rank Fusion (Cormack et al., 2009): a chunk scores the sum of
// 1 / (k + rank) over the lists it appears in. Lists have equal weight, and
// k and the list depth come from config; M4 tunes them on the full golden set.

export interface RankedList<Name extends string> {
  name: Name
  /** Chunk IDs, best first. */
  chunkIds: readonly string[]
}

export interface FusedCandidate<Name extends string> {
  chunkId: string
  /** 1-based position in the fused ranking. */
  rank: number
  score: number
  /** The chunk's 1-based rank in each list it appears in. */
  ranks: Partial<Record<Name, number>>
}

/**
 * Fuses ranked lists, best first. An empty list changes nothing. Ties break
 * by the best single rank, then by chunk ID, so the order is deterministic.
 */
export function fuseRrf<Name extends string>(
  lists: readonly RankedList<Name>[],
  k: number,
): FusedCandidate<Name>[] {
  interface Entry {
    score: number
    best: number
    ranks: Partial<Record<Name, number>>
  }
  const byId = new Map<string, Entry>()
  for (const list of lists) {
    list.chunkIds.forEach((chunkId, index) => {
      const rank = index + 1
      const entry: Entry = byId.get(chunkId) ?? { score: 0, best: Infinity, ranks: {} }
      // A list names each chunk once; keep its first (best) rank if it repeats.
      if (entry.ranks[list.name] !== undefined) return
      entry.score += 1 / (k + rank)
      entry.best = Math.min(entry.best, rank)
      entry.ranks[list.name] = rank
      byId.set(chunkId, entry)
    })
  }
  return [...byId]
    .sort(
      ([idA, a], [idB, b]) =>
        b.score - a.score || a.best - b.best || (idA < idB ? -1 : idA > idB ? 1 : 0),
    )
    .map(([chunkId, entry], index) => ({
      chunkId,
      rank: index + 1,
      score: entry.score,
      ranks: entry.ranks,
    }))
}
