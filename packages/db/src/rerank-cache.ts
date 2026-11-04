// The rerank cache: data/rerank-cache.sqlite (ADR-0014). One entry per call, not per pair,
// because a score depends on the rest of its call. The caller computes the key from the
// model, the query and the documents as sent; this module only stores what came back, so a
// rerun does not call again and replays the same scores.
import { migrate, openDatabase, type SqliteDatabase } from './open.ts'

const MIGRATIONS = [
  `
  create table rerank_calls (
    key text primary key,
    provider text not null,
    scores text not null,
    tokens integer not null,
    created_at text not null
  ) without rowid;
  `,
]

export class RerankCache {
  readonly #db: SqliteDatabase

  constructor(db: SqliteDatabase) {
    migrate(db, MIGRATIONS)
    this.#db = db
  }

  /** The scores of a call, in the order its documents were sent, or undefined. */
  get(key: string): number[] | undefined {
    const row = this.#db.prepare('select scores from rerank_calls where key = ?').get(key) as
      { scores: string } | undefined
    return row === undefined ? undefined : (JSON.parse(row.scores) as number[])
  }

  /** The first entry for a key stays: it is what the reports measured. */
  put(key: string, provider: string, scores: readonly number[], tokens: number): void {
    this.#db
      .prepare(
        `insert or ignore into rerank_calls (key, provider, scores, tokens, created_at)
         values (?, ?, ?, ?, ?)`,
      )
      .run(key, provider, JSON.stringify(scores), tokens, new Date().toISOString())
  }

  count(): number {
    const row = this.#db.prepare('select count(*) as n from rerank_calls').get() as { n: number }
    return row.n
  }

  close(): void {
    this.#db.close()
  }
}

/** Opens data/rerank-cache.sqlite (or ':memory:'), migrating it if needed. */
export function openRerankCache(path: string): RerankCache {
  return new RerankCache(openDatabase(path))
}
