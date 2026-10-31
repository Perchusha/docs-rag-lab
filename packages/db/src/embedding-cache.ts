// The shared embedding cache: data/cache.sqlite (SPEC sections 4 and 6). The
// caller computes the key (ADR-0003); this module only stores vectors.
import { migrate, openDatabase, type SqliteDatabase } from './open.ts'

const MIGRATIONS = [
  `
  create table embeddings (
    key text primary key,
    provider text not null,
    input_type text not null,
    dimensions integer not null,
    vector blob not null,
    created_at text not null
  ) without rowid;
  `,
]

// SQLite's default limit on bound parameters is far higher, but small batches
// keep each statement cheap to prepare.
const KEYS_PER_QUERY = 500

export interface CachedEmbedding {
  key: string
  provider: string
  inputType: string
  vector: Float32Array
}

function toBlob(vector: Float32Array): Buffer {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength)
}

function fromBlob(blob: Buffer): Float32Array {
  // Copy into a fresh, aligned buffer: the blob's offset may not be 4-byte aligned.
  const bytes = new Uint8Array(blob.byteLength)
  bytes.set(blob)
  return new Float32Array(bytes.buffer)
}

export class EmbeddingCache {
  readonly #db: SqliteDatabase

  constructor(db: SqliteDatabase) {
    this.#db = db
    migrate(db, MIGRATIONS)
  }

  close(): void {
    this.#db.close()
  }

  /** The cached vectors for `keys`; missing keys are absent from the map. */
  getMany(keys: readonly string[]): Map<string, Float32Array> {
    const found = new Map<string, Float32Array>()
    for (let start = 0; start < keys.length; start += KEYS_PER_QUERY) {
      const batch = keys.slice(start, start + KEYS_PER_QUERY)
      const rows = this.#db
        .prepare(
          `select key, vector from embeddings where key in (${batch.map(() => '?').join(', ')})`,
        )
        .all(...batch) as { key: string; vector: Buffer }[]
      for (const row of rows) found.set(row.key, fromBlob(row.vector))
    }
    return found
  }

  /** Stores vectors in one transaction. An existing key keeps its first vector. */
  putMany(entries: readonly CachedEmbedding[]): void {
    const insert = this.#db.prepare(
      `insert into embeddings (key, provider, input_type, dimensions, vector, created_at)
       values (?, ?, ?, ?, ?, ?)
       on conflict (key) do nothing`,
    )
    const createdAt = new Date().toISOString()
    this.#db.transaction(() => {
      for (const entry of entries) {
        insert.run(
          entry.key,
          entry.provider,
          entry.inputType,
          entry.vector.length,
          toBlob(entry.vector),
          createdAt,
        )
      }
    })()
  }

  count(): number {
    const row = this.#db.prepare('select count(*) as n from embeddings').get() as { n: number }
    return row.n
  }
}

/** Opens data/cache.sqlite (or ':memory:'), migrating it if needed. */
export function openEmbeddingCache(path: string): EmbeddingCache {
  return new EmbeddingCache(openDatabase(path))
}
