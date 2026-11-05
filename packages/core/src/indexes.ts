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

/**
 * Another index of the same source, beside the plain one, which stays as it is. The contextual and
 * control indexes have the plain index's chunks with a prefix (ADR-0014). The compiled one has
 * chunks of its own, with the twoslash compiler's output after each example (ADR-0017).
 */
export type IndexVariant = 'contextual' | 'control' | 'compiled'

/** The variants whose chunks are the plain index's, each with a prefix. */
export function hasPrefixedChunks(variant: IndexVariant): variant is 'contextual' | 'control' {
  return variant !== 'compiled'
}

export function variantIndexPath(dataDir: string, sourceId: string, variant: IndexVariant): string {
  return join(dataDir, 'sources', `${sourceId}.${variant}.sqlite`)
}

export function embeddingCachePath(dataDir: string): string {
  return join(dataDir, 'cache.sqlite')
}

export function rerankCachePath(dataDir: string): string {
  return join(dataDir, 'rerank-cache.sqlite')
}

/** There is no index for the source yet. The message says what to run. */
export class IndexNotFoundError extends Error {
  constructor(sourceId: string, variant?: IndexVariant) {
    super(
      variant === undefined
        ? `there is no index for ${sourceId} yet: run drl sync ${sourceId} first`
        : `there is no ${variant} index for ${sourceId} yet: run drl sync ${sourceId} --${variant} first`,
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
  /** This index instead of the plain one. The caches are the same. */
  variant?: IndexVariant | undefined
}

/** Opens data/sources/<id>.sqlite and data/cache.sqlite. The cache is always created if needed. */
export function openIndexes(
  dataDir: string,
  sourceId: string,
  options: OpenIndexesOptions = {},
): OpenIndexes {
  const { variant } = options
  const indexPath =
    variant === undefined
      ? sourceIndexPath(dataDir, sourceId)
      : variantIndexPath(dataDir, sourceId, variant)
  const cachePath = embeddingCachePath(dataDir)
  if (options.create === false && !existsSync(indexPath)) {
    throw new IndexNotFoundError(sourceId, variant)
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
