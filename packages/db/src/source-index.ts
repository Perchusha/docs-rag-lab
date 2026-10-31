// The per-source index: data/sources/<source-id>.sqlite (SPEC sections 4 and 6).
// M1 tables only: manifest, documents, chunks and the chunks_vec vector table.
// FTS arrives in M2, eval tables in M4.
import { migrate, openDatabase, type SqliteDatabase } from './open.ts'

const MIGRATIONS = [
  `
  create table manifest (
    id integer primary key check (id = 1),
    source_id text not null,
    repo text not null,
    branch text not null,
    include_paths text not null,
    commit_sha text not null,
    synced_at text not null,
    embed_model text not null,
    embed_dimensions integer not null,
    context_model text,
    chunker_version integer not null
  );
  create table documents (
    id integer primary key,
    path text not null unique,
    url text not null,
    title text not null,
    doc_type text not null,
    content_hash text not null,
    last_changed_sha text not null
  );
  create index documents_doc_type on documents (doc_type);
  -- pk is an explicit integer primary key, so VACUUM never renumbers it: it is
  -- the rowid of the chunk's row in chunks_vec. id is the stable chunk ID.
  create table chunks (
    pk integer primary key,
    id text not null unique,
    doc_id integer not null references documents (id) on delete cascade,
    ordinal integer not null,
    heading_path text not null,
    anchor text not null,
    block_types text not null,
    text text not null,
    context text,
    metadata text not null,
    token_count integer not null,
    text_hash text not null
  );
  create index chunks_doc_id on chunks (doc_id);
  `,
]

export interface Manifest {
  sourceId: string
  repo: string
  branch: string
  /** The source include list at sync time; a different list forces a full rebuild. */
  includePaths: string[]
  commitSha: string
  syncedAt: string
  embedModel: string
  embedDimensions: number
  contextModel: string | null
  chunkerVersion: number
}

export interface ChunkWrite {
  id: string
  ordinal: number
  headingPath: readonly string[]
  anchor: string
  blockTypes: readonly string[]
  text: string
  metadata: Record<string, unknown>
  tokenCount: number
  textHash: string
  /** A new vector, or undefined to keep the stored one (the chunk text did not change). */
  vector?: Float32Array | undefined
}

export interface DocumentWrite {
  path: string
  url: string
  title: string
  docType: string
  contentHash: string
  lastChangedSha: string
  /** Every chunk the document has now. Stored chunks missing from this list are deleted. */
  chunks: readonly ChunkWrite[]
}

export interface IndexChanges {
  documents: readonly DocumentWrite[]
  deletePaths: readonly string[]
  manifest: Manifest
  /** Drop and recreate chunks_vec with this many dimensions first (embedding model change). */
  resetVectors?: number | undefined
}

export interface SearchHit {
  chunkId: string
  distance: number
  text: string
  headingPath: string[]
  anchor: string
  blockTypes: string[]
  metadata: Record<string, unknown>
  tokenCount: number
  docPath: string
  url: string
  title: string
  docType: string
}

export interface DocTypeStats {
  docType: string
  documents: number
  chunks: number
  tokens: number
}

export interface IndexStats {
  documents: number
  chunks: number
  tokens: number
  byDocType: DocTypeStats[]
}

interface ManifestRow {
  source_id: string
  repo: string
  branch: string
  include_paths: string
  commit_sha: string
  synced_at: string
  embed_model: string
  embed_dimensions: number
  context_model: string | null
  chunker_version: number
}

interface SearchRow {
  id: string
  distance: number
  text: string
  heading_path: string
  anchor: string
  block_types: string
  metadata: string
  token_count: number
  path: string
  url: string
  title: string
  doc_type: string
}

function parseStringArray(text: string): string[] {
  const value: unknown = JSON.parse(text)
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`expected a JSON string array, got ${text}`)
  }
  return value
}

function parseRecord(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`expected a JSON object, got ${text}`)
  }
  return value as Record<string, unknown>
}

/** better-sqlite3 binds JS numbers as REAL; vec0 rowids must be integers. */
function vecRowid(pk: number): bigint {
  return BigInt(pk)
}

export class SourceIndex {
  readonly #db: SqliteDatabase

  constructor(db: SqliteDatabase) {
    this.#db = db
    migrate(db, MIGRATIONS)
  }

  close(): void {
    this.#db.close()
  }

  getManifest(): Manifest | undefined {
    const row = this.#db.prepare('select * from manifest where id = 1').get() as
      ManifestRow | undefined
    if (row === undefined) return undefined
    return {
      sourceId: row.source_id,
      repo: row.repo,
      branch: row.branch,
      includePaths: parseStringArray(row.include_paths),
      commitSha: row.commit_sha,
      syncedAt: row.synced_at,
      embedModel: row.embed_model,
      embedDimensions: row.embed_dimensions,
      contextModel: row.context_model,
      chunkerVersion: row.chunker_version,
    }
  }

  hasVectorTable(): boolean {
    const row = this.#db
      .prepare("select 1 from sqlite_master where type = 'table' and name = 'chunks_vec'")
      .get()
    return row !== undefined
  }

  /** Paths of every indexed document. */
  documentPaths(): string[] {
    const rows = this.#db.prepare('select path from documents order by path').all() as {
      path: string
    }[]
    return rows.map((row) => row.path)
  }

  /** The stored chunk IDs of one document and their text hashes. */
  chunkHashes(path: string): Map<string, string> {
    const rows = this.#db
      .prepare(
        'select c.id, c.text_hash from chunks c join documents d on d.id = c.doc_id where d.path = ?',
      )
      .all(path) as { id: string; text_hash: string }[]
    return new Map(rows.map((row) => [row.id, row.text_hash]))
  }

  /**
   * Applies one sync in a single transaction: deletes, document and chunk
   * upserts, vectors, then the manifest. Throws (and rolls back) if a chunk
   * would end up without a vector.
   */
  applyChanges(changes: IndexChanges): void {
    const db = this.#db
    db.transaction(() => {
      if (changes.resetVectors !== undefined) this.#createVectorTable(changes.resetVectors, true)
      else if (!this.hasVectorTable()) {
        this.#createVectorTable(changes.manifest.embedDimensions, false)
      }

      for (const path of changes.deletePaths) this.#deleteDocument(path)
      for (const doc of changes.documents) this.#writeDocument(doc)

      const counts = db
        .prepare(
          'select (select count(*) from chunks) as chunks, (select count(*) from chunks_vec) as vectors',
        )
        .get() as { chunks: number; vectors: number }
      if (counts.chunks !== counts.vectors) {
        throw new Error(
          `index would hold ${String(counts.chunks)} chunks but ${String(counts.vectors)} vectors`,
        )
      }

      this.#writeManifest(changes.manifest)
    })()
  }

  /** The k nearest chunks to `vector` by cosine distance, closest first. */
  searchVectors(vector: Float32Array, k: number): SearchHit[] {
    const rows = this.#db
      .prepare(
        `with knn as (
           select rowid, distance from chunks_vec where embedding match ? and k = ?
         )
         select c.id, knn.distance, c.text, c.heading_path, c.anchor, c.block_types, c.metadata,
                c.token_count, d.path, d.url, d.title, d.doc_type
         from knn
         join chunks c on c.pk = knn.rowid
         join documents d on d.id = c.doc_id
         order by knn.distance`,
      )
      .all(vector, k) as SearchRow[]
    return rows.map((row) => ({
      chunkId: row.id,
      distance: row.distance,
      text: row.text,
      headingPath: parseStringArray(row.heading_path),
      anchor: row.anchor,
      blockTypes: parseStringArray(row.block_types),
      metadata: parseRecord(row.metadata),
      tokenCount: row.token_count,
      docPath: row.path,
      url: row.url,
      title: row.title,
      docType: row.doc_type,
    }))
  }

  stats(): IndexStats {
    const byDocType = this.#db
      .prepare(
        `select d.doc_type as docType,
                count(distinct d.id) as documents,
                count(c.pk) as chunks,
                coalesce(sum(c.token_count), 0) as tokens
         from documents d left join chunks c on c.doc_id = d.id
         group by d.doc_type order by d.doc_type`,
      )
      .all() as DocTypeStats[]
    return {
      documents: byDocType.reduce((sum, row) => sum + row.documents, 0),
      chunks: byDocType.reduce((sum, row) => sum + row.chunks, 0),
      tokens: byDocType.reduce((sum, row) => sum + row.tokens, 0),
      byDocType,
    }
  }

  #createVectorTable(dimensions: number, dropExisting: boolean): void {
    if (!Number.isInteger(dimensions) || dimensions <= 0) {
      throw new Error(`invalid embedding dimensions: ${String(dimensions)}`)
    }
    if (dropExisting) this.#db.exec('drop table if exists chunks_vec')
    this.#db.exec(
      `create virtual table chunks_vec using vec0(embedding float[${String(dimensions)}] distance_metric=cosine)`,
    )
  }

  #deleteDocument(path: string): void {
    const db = this.#db
    const doc = db.prepare('select id from documents where path = ?').get(path) as
      { id: number } | undefined
    if (doc === undefined) return
    const pks = db.prepare('select pk from chunks where doc_id = ?').all(doc.id) as { pk: number }[]
    const deleteVector = db.prepare('delete from chunks_vec where rowid = ?')
    for (const { pk } of pks) deleteVector.run(vecRowid(pk))
    db.prepare('delete from documents where id = ?').run(doc.id)
  }

  #writeDocument(doc: DocumentWrite): void {
    const db = this.#db
    const { id: docId } = db
      .prepare(
        `insert into documents (path, url, title, doc_type, content_hash, last_changed_sha)
         values (@path, @url, @title, @docType, @contentHash, @lastChangedSha)
         on conflict (path) do update set
           url = excluded.url, title = excluded.title, doc_type = excluded.doc_type,
           content_hash = excluded.content_hash, last_changed_sha = excluded.last_changed_sha
         returning id`,
      )
      .get({
        path: doc.path,
        url: doc.url,
        title: doc.title,
        docType: doc.docType,
        contentHash: doc.contentHash,
        lastChangedSha: doc.lastChangedSha,
      }) as { id: number }

    const stored = new Map(
      (
        db.prepare('select id, pk from chunks where doc_id = ?').all(docId) as {
          id: string
          pk: number
        }[]
      ).map((row) => [row.id, row.pk]),
    )
    const wanted = new Set(doc.chunks.map((chunk) => chunk.id))

    const deleteVector = db.prepare('delete from chunks_vec where rowid = ?')
    const insertVector = db.prepare('insert into chunks_vec (rowid, embedding) values (?, ?)')
    const deleteChunk = db.prepare('delete from chunks where pk = ?')
    for (const [id, pk] of stored) {
      if (wanted.has(id)) continue
      deleteVector.run(vecRowid(pk))
      deleteChunk.run(pk)
    }

    const upsertChunk = db.prepare(
      `insert into chunks (id, doc_id, ordinal, heading_path, anchor, block_types, text, context,
                           metadata, token_count, text_hash)
       values (@id, @docId, @ordinal, @headingPath, @anchor, @blockTypes, @text, null,
               @metadata, @tokenCount, @textHash)
       on conflict (id) do update set
         doc_id = excluded.doc_id, ordinal = excluded.ordinal, heading_path = excluded.heading_path,
         anchor = excluded.anchor, block_types = excluded.block_types, text = excluded.text,
         metadata = excluded.metadata, token_count = excluded.token_count,
         text_hash = excluded.text_hash
       returning pk`,
    )
    for (const chunk of doc.chunks) {
      const { pk } = upsertChunk.get({
        id: chunk.id,
        docId,
        ordinal: chunk.ordinal,
        headingPath: JSON.stringify(chunk.headingPath),
        anchor: chunk.anchor,
        blockTypes: JSON.stringify(chunk.blockTypes),
        text: chunk.text,
        metadata: JSON.stringify(chunk.metadata),
        tokenCount: chunk.tokenCount,
        textHash: chunk.textHash,
      }) as { pk: number }
      if (chunk.vector !== undefined) {
        deleteVector.run(vecRowid(pk))
        insertVector.run(vecRowid(pk), chunk.vector)
      }
    }
  }

  #writeManifest(manifest: Manifest): void {
    this.#db
      .prepare(
        `insert into manifest (id, source_id, repo, branch, include_paths, commit_sha, synced_at, embed_model,
                               embed_dimensions, context_model, chunker_version)
         values (1, @sourceId, @repo, @branch, @includePaths, @commitSha, @syncedAt, @embedModel,
                 @embedDimensions, @contextModel, @chunkerVersion)
         on conflict (id) do update set
           source_id = excluded.source_id, repo = excluded.repo, branch = excluded.branch,
           include_paths = excluded.include_paths,
           commit_sha = excluded.commit_sha, synced_at = excluded.synced_at,
           embed_model = excluded.embed_model, embed_dimensions = excluded.embed_dimensions,
           context_model = excluded.context_model, chunker_version = excluded.chunker_version`,
      )
      .run({ ...manifest, includePaths: JSON.stringify(manifest.includePaths) })
  }
}

/** Opens data/sources/<source-id>.sqlite (or ':memory:'), migrating it if needed. */
export function openSourceIndex(path: string): SourceIndex {
  return new SourceIndex(openDatabase(path))
}
