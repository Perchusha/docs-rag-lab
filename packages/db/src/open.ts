import Database from 'better-sqlite3'
import * as sqliteVec from 'sqlite-vec'

export type SqliteDatabase = Database.Database

/**
 * Opens (or creates) a SQLite file with sqlite-vec loaded, WAL journaling and
 * foreign keys on. Use ':memory:' for a throwaway database.
 */
export function openDatabase(path: string): SqliteDatabase {
  const db = new Database(path)
  sqliteVec.load(db)
  if (path !== ':memory:') db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  return db
}

/**
 * Applies the migrations that are newer than the file's `user_version`, each
 * in its own transaction. Migration N (1-based) brings the file to version N.
 */
export function migrate(db: SqliteDatabase, migrations: readonly string[]): void {
  const current = db.pragma('user_version', { simple: true })
  if (typeof current !== 'number') throw new Error('PRAGMA user_version did not return a number')
  if (current > migrations.length) {
    throw new Error(
      `database schema version ${String(current)} is newer than this code (${String(migrations.length)})`,
    )
  }
  migrations.slice(current).forEach((sql, index) => {
    db.transaction(() => {
      db.exec(sql)
      db.pragma(`user_version = ${String(current + index + 1)}`)
    })()
  })
}
