// Where the generated data lives (SPEC section 4): one index per source and
// one shared embedding cache.
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

import {
  openEmbeddingCache,
  openSourceIndex,
  type EmbeddingCache,
  type SourceIndex,
} from '@docs-rag-lab/db'

export function sourceIndexPath(dataDir: string, sourceId: string): string {
  return join(dataDir, 'sources', `${sourceId}.sqlite`)
}

export function embeddingCachePath(dataDir: string): string {
  return join(dataDir, 'cache.sqlite')
}

export interface OpenIndexes {
  index: SourceIndex
  cache: EmbeddingCache
  close(): void
}

/** Opens (and creates, if needed) data/sources/<id>.sqlite and data/cache.sqlite. */
export function openIndexes(dataDir: string, sourceId: string): OpenIndexes {
  const indexPath = sourceIndexPath(dataDir, sourceId)
  const cachePath = embeddingCachePath(dataDir)
  mkdirSync(dirname(indexPath), { recursive: true })
  mkdirSync(dirname(cachePath), { recursive: true })
  const index = openSourceIndex(indexPath)
  const cache = openEmbeddingCache(cachePath)
  return {
    index,
    cache,
    close: () => {
      index.close()
      cache.close()
    },
  }
}
