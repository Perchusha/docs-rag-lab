// Public entry of @docs-rag-lab/db: SQLite schemas, migrations and typed queries.
export { migrate, openDatabase, type Migration, type SqliteDatabase } from './open.ts'
export {
  openSourceIndex,
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
} from './source-index.ts'
export { EmbeddingCache, openEmbeddingCache, type CachedEmbedding } from './embedding-cache.ts'
