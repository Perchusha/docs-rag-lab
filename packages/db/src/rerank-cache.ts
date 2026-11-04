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
  // Version 2: how many 429s a call survived, so a report replayed from here can say so.
  `alter table rerank_calls add column rate_limit_retries integer not null default 0;`,
]

export interface CachedRerankCall {
  /** In the order the call's documents were sent. */
  scores: number[]
  /** How many 429s the call survived before it got these. */
  rateLimitRetries: number
}

export class RerankCache {
  readonly #db: SqliteDatabase

  constructor(db: SqliteDatabase) {
    migrate(db, MIGRATIONS)
    this.#db = db
  }

  /** What a call came back with, or undefined. */
  get(key: string): CachedRerankCall | undefined {
    const row = this.#db
      .prepare('select scores, rate_limit_retries from rerank_calls where key = ?')
      .get(key) as { scores: string; rate_limit_retries: number } | undefined
    return row === undefined
      ? undefined
      : {
          scores: JSON.parse(row.scores) as number[],
          rateLimitRetries: row.rate_limit_retries,
        }
  }

  /** The first entry for a key stays: it is what the reports measured. */
  put(
    key: string,
    provider: string,
    scores: readonly number[],
    tokens: number,
    rateLimitRetries = 0,
  ): void {
    this.#db
      .prepare(
        `insert or ignore into rerank_calls
         (key, provider, scores, tokens, created_at, rate_limit_retries)
         values (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        key,
        provider,
        JSON.stringify(scores),
        tokens,
        new Date().toISOString(),
        rateLimitRetries,
      )
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
