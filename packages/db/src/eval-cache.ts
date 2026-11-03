// The answer and verdict cache: data/eval-cache.sqlite (ADR-0009, ADR-0012). The caller
// computes the key from the whole request; this module only stores what came back, so a
// rerun does not pay twice.
import { migrate, openDatabase, type SqliteDatabase } from './open.ts'

const MIGRATIONS = [
  `
  create table eval_cache (
    key text primary key,
    kind text not null,
    value text not null,
    input_tokens integer not null,
    output_tokens integer not null,
    created_at text not null
  ) without rowid;
  `,
]

export interface EvalCacheEntry {
  value: unknown
  inputTokens: number
  outputTokens: number
}

/** What past calls of one kind cost, to estimate the next ones. */
export interface EvalCacheStats {
  calls: number
  meanInputTokens: number
  meanOutputTokens: number
}

export class EvalCache {
  readonly #db: SqliteDatabase

  constructor(db: SqliteDatabase) {
    migrate(db, MIGRATIONS)
    this.#db = db
  }

  get(key: string): unknown {
    const row = this.#db.prepare('select value from eval_cache where key = ?').get(key) as
      { value: string } | undefined
    return row === undefined ? undefined : JSON.parse(row.value)
  }

  has(key: string): boolean {
    return this.#db.prepare('select 1 from eval_cache where key = ?').get(key) !== undefined
  }

  /** The first entry for a key stays: it is what was paid for and judged. */
  put(
    key: string,
    kind: string,
    entry: EvalCacheEntry,
    createdAt = new Date().toISOString(),
  ): void {
    this.#db
      .prepare(
        `insert or ignore into eval_cache
         (key, kind, value, input_tokens, output_tokens, created_at)
         values (?, ?, ?, ?, ?, ?)`,
      )
      .run(key, kind, JSON.stringify(entry.value), entry.inputTokens, entry.outputTokens, createdAt)
  }

  stats(kind: string): EvalCacheStats {
    const row = this.#db
      .prepare(
        `select count(*) as calls, avg(input_tokens) as input, avg(output_tokens) as output
         from eval_cache where kind = ?`,
      )
      .get(kind) as { calls: number; input: number | null; output: number | null }
    return {
      calls: row.calls,
      meanInputTokens: row.input ?? 0,
      meanOutputTokens: row.output ?? 0,
    }
  }

  close(): void {
    this.#db.close()
  }
}

/** Opens data/eval-cache.sqlite (or ':memory:'), migrating it if needed. */
export function openEvalCache(path: string): EvalCache {
  return new EvalCache(openDatabase(path))
}
