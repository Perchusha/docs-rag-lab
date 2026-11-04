// Where the generated data lives (SPEC section 4): one index per source, one
// shared embedding cache, and one cache of rerank calls.
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

import {
  openEmbeddingCache,
  openRerankCache,
  openSourceIndex,
  type EmbeddingCache,
  type RerankCache,
  type SourceIndex,
} from '@docs-rag-lab/db'

export function sourceIndexPath(dataDir: string, sourceId: string): string {
  return join(dataDir, 'sources', `${sourceId}.sqlite`)
}

/** The index whose chunks carry generated contexts (ADR-0014). The plain one stays as it is. */
export function contextualIndexPath(dataDir: string, sourceId: string): string {
  return join(dataDir, 'sources', `${sourceId}.contextual.sqlite`)
}

export function embeddingCachePath(dataDir: string): string {
  return join(dataDir, 'cache.sqlite')
}

export function rerankCachePath(dataDir: string): string {
  return join(dataDir, 'rerank-cache.sqlite')
}

/** There is no index for the source yet. The message says what to run. */
export class IndexNotFoundError extends Error {
  constructor(sourceId: string, contextual = false) {
    super(
      contextual
        ? `there is no contextual index for ${sourceId} yet: run drl sync ${sourceId} --contextual first`
        : `there is no index for ${sourceId} yet: run drl sync ${sourceId} first`,
    )
    this.name = 'IndexNotFoundError'
  }
}

export interface OpenIndexes {
  index: SourceIndex
  cache: EmbeddingCache
  /** Opened on first use, so that a search with no rerank creates no file. */
  rerankCache(): RerankCache
  close(): void
}

export interface OpenIndexesOptions {
  /**
   * Create the source index when it does not exist (default). Readers pass
   * false, so a question before the first sync creates no file and gets a
   * message that says what to run.
   */
  create?: boolean
  /** The contextual index instead of the plain one. The caches are the same. */
  contextual?: boolean
}

/** Opens data/sources/<id>.sqlite and data/cache.sqlite. The cache is always created if needed. */
export function openIndexes(
  dataDir: string,
  sourceId: string,
  options: OpenIndexesOptions = {},
): OpenIndexes {
  const contextual = options.contextual === true
  const indexPath = contextual
    ? contextualIndexPath(dataDir, sourceId)
    : sourceIndexPath(dataDir, sourceId)
  const cachePath = embeddingCachePath(dataDir)
  if (options.create === false && !existsSync(indexPath)) {
    throw new IndexNotFoundError(sourceId, contextual)
  }
  mkdirSync(dirname(indexPath), { recursive: true })
  mkdirSync(dirname(cachePath), { recursive: true })
  const index = openSourceIndex(indexPath)
  const cache = openEmbeddingCache(cachePath)
  let rerankCache: RerankCache | undefined
  return {
    index,
    cache,
    rerankCache: () => (rerankCache ??= openRerankCache(rerankCachePath(dataDir))),
    close: () => {
      index.close()
      cache.close()
      rerankCache?.close()
    },
  }
}
