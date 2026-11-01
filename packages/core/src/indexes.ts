// Where the generated data lives (SPEC section 4): one index per source and
// one shared embedding cache.
import { existsSync, mkdirSync } from 'node:fs'
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

/** There is no index for the source yet. The message says what to run. */
export class IndexNotFoundError extends Error {
  constructor(sourceId: string) {
    super(`there is no index for ${sourceId} yet: run drl sync ${sourceId} first`)
    this.name = 'IndexNotFoundError'
  }
}

export interface OpenIndexes {
  index: SourceIndex
  cache: EmbeddingCache
  close(): void
}

export interface OpenIndexesOptions {
  /**
   * Create the source index when it does not exist (default). Readers pass
   * false, so a question before the first sync creates no file and gets a
   * message that says what to run.
   */
  create?: boolean
}

/** Opens data/sources/<id>.sqlite and data/cache.sqlite. The cache is always created if needed. */
export function openIndexes(
  dataDir: string,
  sourceId: string,
  options: OpenIndexesOptions = {},
): OpenIndexes {
  const indexPath = sourceIndexPath(dataDir, sourceId)
  const cachePath = embeddingCachePath(dataDir)
  if (options.create === false && !existsSync(indexPath)) {
    throw new IndexNotFoundError(sourceId)
  }
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
