// Public entry of @docs-rag-lab/db: SQLite schemas, migrations and typed queries.
export { migrate, openDatabase, type Migration, type SqliteDatabase } from './open.ts'
export {
  openSourceIndex,
  readIndexCommit,
  SourceIndex,
  type Candidate,
  type ChunkWrite,
  type DocTypeStats,
  type DocumentWrite,
  type IndexChanges,
  type IndexStats,
  type Manifest,
  type SearchFilter,
  type SearchHit,
  type StoredChunk,
  type StoredDocument,
} from './source-index.ts'
export { EmbeddingCache, openEmbeddingCache, type CachedEmbedding } from './embedding-cache.ts'
export { openRerankCache, RerankCache } from './rerank-cache.ts'
export { EvalCache, openEvalCache, type EvalCacheEntry, type EvalCacheStats } from './eval-cache.ts'
