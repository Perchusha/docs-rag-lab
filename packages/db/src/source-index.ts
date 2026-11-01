// The per-source index: data/sources/<source-id>.sqlite (SPEC sections 4 and 6).
// Tables: manifest, documents, chunks, the chunks_fts keyword index and the
// chunks_vec vector table (ADR-0004, ADR-0005). Eval tables arrive in M4.
import { migrate, openDatabase, type Migration, type SqliteDatabase } from './open.ts'

// The keyword index reads its text from chunks (external content), so it
// stores only the index. Triggers keep it in sync with every write to chunks,
// including cascade deletes and later context updates. The trigram tokenizer
// matches substrings, so "unchecked indexed access" finds
// noUncheckedIndexedAccess (ADR-0005).
const KEYWORD_INDEX = `
  create virtual table chunks_fts using fts5(
    heading_path, context, text,
    content = 'chunks', content_rowid = 'pk', tokenize = 'trigram'
  );
  create trigger chunks_fts_insert after insert on chunks begin
    insert into chunks_fts (rowid, heading_path, context, text)
    values (new.pk, new.heading_path, new.context, new.text);
  end;
  create trigger chunks_fts_delete after delete on chunks begin
    insert into chunks_fts (chunks_fts, rowid, heading_path, context, text)
    values ('delete', old.pk, old.heading_path, old.context, old.text);
  end;
  create trigger chunks_fts_update after update of heading_path, context, text on chunks begin
    insert into chunks_fts (chunks_fts, rowid, heading_path, context, text)
    values ('delete', old.pk, old.heading_path, old.context, old.text);
    insert into chunks_fts (rowid, heading_path, context, text)
    values (new.pk, new.heading_path, new.context, new.text);
  end;
  insert into chunks_fts (chunks_fts) values ('rebuild');
`

function vectorTableSql(dimensions: number): string {
  if (!Number.isInteger(dimensions) || dimensions <= 0) {
    throw new Error(`invalid embedding dimensions: ${String(dimensions)}`)
  }
  // doc_type is a metadata column, so docType filters run inside the KNN query.
  return `create virtual table chunks_vec using vec0(
    doc_type text,
    embedding float[${String(dimensions)}] distance_metric=cosine
  )`
}

/**
 * Version 2: the parser version in the manifest, the keyword index, and a
 * doc_type column in chunks_vec. vec0 cannot add a column in place, so the
 * stored vectors are copied into the new table; nothing is embedded again.
 */
function addKeywordIndexAndDocTypes(db: SqliteDatabase): void {
  db.exec('alter table manifest add column parser_version integer')
  db.exec(KEYWORD_INDEX)

  const table = db
    .prepare("select sql from sqlite_master where type = 'table' and name = 'chunks_vec'")
    .get() as { sql: string } | undefined
  if (table === undefined) return
  const dimensions = Number(/float\[(\d+)\]/.exec(table.sql)?.[1])
  const { vectors } = db.prepare('select count(*) as vectors from chunks_vec').get() as {
    vectors: number
  }
  db.exec(`
    create temp table vectors_v1 as
      select v.rowid as pk, d.doc_type as doc_type, v.embedding as embedding
      from chunks_vec v join chunks c on c.pk = v.rowid join documents d on d.id = c.doc_id;
    drop table chunks_vec;
    ${vectorTableSql(dimensions)};
    insert into chunks_vec (rowid, doc_type, embedding)
      select pk, doc_type, embedding from vectors_v1;
    drop table vectors_v1;
  `)
  const { copied } = db.prepare('select count(*) as copied from chunks_vec').get() as {
    copied: number
  }
  if (copied !== vectors) {
    throw new Error(`copied ${String(copied)} of ${String(vectors)} vectors into the new table`)
  }
}

const MIGRATIONS: readonly Migration[] = [
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
  addKeywordIndexAndDocTypes,
  // Version 3: a sync upserts every chunk of a parsed document, so the version 2
  // trigger re-indexed unchanged text too, and a full rebuild doubled the
  // keyword index on disk. Re-index only text that changed, then merge the
  // index segments.
  `
  drop trigger chunks_fts_update;
  create trigger chunks_fts_update after update of heading_path, context, text on chunks
  when old.heading_path is not new.heading_path
    or old.context is not new.context
    or old.text is not new.text
  begin
    insert into chunks_fts (chunks_fts, rowid, heading_path, context, text)
    values ('delete', old.pk, old.heading_path, old.context, old.text);
    insert into chunks_fts (rowid, heading_path, context, text)
    values (new.pk, new.heading_path, new.context, new.text);
  end;
  insert into chunks_fts (chunks_fts) values ('optimize');
  `,
]

/** Exported for the migration tests; not part of the package entry. */
export const SOURCE_INDEX_MIGRATIONS = MIGRATIONS

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
  /** The source's parser version; null for an index synced before M2. */
  parserVersion: number | null
}

export interface ChunkWrite {
  id: string
  /** 0-based position in the document (source-kit's Chunk.ordinal), not the pack number in the chunk ID. */
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

/** Restricts a search. An empty or missing list means no restriction. */
export interface SearchFilter {
  docTypes?: readonly string[] | undefined
}

/** One entry of a candidate list: the chunk and the score that ranked it. */
export interface Candidate {
  chunkId: string
  score: number
}

/** A chunk with its document, as retrieval hands it to generation. */
export interface SearchHit {
  chunkId: string
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

/** A chunk as the chunk-boundary view shows it. */
export interface StoredChunk {
  chunkId: string
  /** 0-based position in the document. */
  ordinal: number
  headingPath: string[]
  anchor: string
  blockTypes: string[]
  text: string
  /** The contextual retrieval prefix (M5), or null. */
  context: string | null
  metadata: Record<string, unknown>
  tokenCount: number
}

/** A document with all its chunks, in document order. */
export interface StoredDocument {
  path: string
  url: string
  title: string
  docType: string
  chunks: StoredChunk[]
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
  parser_version: number | null
}

interface ChunkRow {
  id: string
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

function toSearchHit(row: ChunkRow): SearchHit {
  return {
    chunkId: row.id,
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
  }
}

/** `?, ?, ?` for an IN list. */
function placeholders(values: readonly unknown[]): string {
  return values.map(() => '?').join(', ')
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
      parserVersion: row.parser_version,
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

  /** The stored content hash of a document, and the commit where its content last changed. */
  documentVersion(path: string): { contentHash: string; lastChangedSha: string } | undefined {
    const row = this.#db
      .prepare('select content_hash, last_changed_sha from documents where path = ?')
      .get(path) as { content_hash: string; last_changed_sha: string } | undefined
    return row === undefined
      ? undefined
      : { contentHash: row.content_hash, lastChangedSha: row.last_changed_sha }
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
   * upserts, vectors, then the manifest. The keyword index follows the chunks
   * through triggers. Throws (and rolls back) if a chunk would end up without
   * a vector, a vector with a stale doc type, or the keyword index out of sync.
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

      // Every chunk has exactly one vector: none is missing (vec0 rowids are
      // unique), and the totals match, so there is no orphan vector either.
      const counts = db
        .prepare(
          `select (select count(*) from chunks) as chunks,
                  (select count(*) from chunks_vec) as vectors,
                  (select count(*) from chunks c
                   where not exists (select 1 from chunks_vec v where v.rowid = c.pk)) as missing`,
        )
        .get() as { chunks: number; vectors: number; missing: number }
      if (counts.missing > 0 || counts.chunks !== counts.vectors) {
        throw new Error(
          `index would hold ${String(counts.chunks)} chunks but ${String(counts.vectors)} vectors (${String(counts.missing)} chunks without one)`,
        )
      }
      const { stale } = db
        .prepare(
          `select count(*) as stale from chunks_vec v
           join chunks c on c.pk = v.rowid join documents d on d.id = c.doc_id
           where v.doc_type is not d.doc_type`,
        )
        .get() as { stale: number }
      if (stale > 0) throw new Error(`${String(stale)} vectors carry a stale doc type`)
      this.#checkKeywordIndex()

      this.#writeManifest(changes.manifest)
    })()
  }

  /**
   * The k nearest chunks to `vector` by cosine distance, closest first. The
   * doc type filter runs inside the KNN query, so it still returns k chunks.
   */
  searchVectors(vector: Float32Array, k: number, filter: SearchFilter = {}): Candidate[] {
    const docTypes = filter.docTypes ?? []
    const where = docTypes.length > 0 ? `and doc_type in (${placeholders(docTypes)})` : ''
    const rows = this.#db
      .prepare(
        `with knn as (
           select rowid, distance from chunks_vec where embedding match ? and k = ? ${where}
         )
         select c.id, knn.distance from knn join chunks c on c.pk = knn.rowid
         order by knn.distance, c.id`,
      )
      .all(vector, k, ...docTypes) as { id: string; distance: number }[]
    return rows.map((row) => ({ chunkId: row.id, score: row.distance }))
  }

  /**
   * The k best chunks for an FTS5 query, best first. The score is BM25 with
   * the sign flipped, so higher is better. The caller builds the query
   * (core quotes every term); an invalid one throws.
   */
  searchKeywords(query: string, k: number, filter: SearchFilter = {}): Candidate[] {
    const docTypes = filter.docTypes ?? []
    const where = docTypes.length > 0 ? `and d.doc_type in (${placeholders(docTypes)})` : ''
    const rows = this.#db
      .prepare(
        `select c.id, -bm25(chunks_fts) as score
         from chunks_fts
         join chunks c on c.pk = chunks_fts.rowid
         join documents d on d.id = c.doc_id
         where chunks_fts match ? ${where}
         order by bm25(chunks_fts), c.id
         limit ?`,
      )
      .all(query, ...docTypes, k) as { id: string; score: number }[]
    return rows.map((row) => ({ chunkId: row.id, score: row.score }))
  }

  /** The chunks with these IDs, with their documents. Unknown IDs are absent from the map. */
  chunksById(ids: readonly string[]): Map<string, SearchHit> {
    const rows = this.#db
      .prepare(
        `select c.id, c.text, c.heading_path, c.anchor, c.block_types, c.metadata, c.token_count,
                d.path, d.url, d.title, d.doc_type
         from chunks c join documents d on d.id = c.doc_id
         where c.id in (select value from json_each(?))`,
      )
      .all(JSON.stringify(ids)) as ChunkRow[]
    return new Map(rows.map((row) => [row.id, toSearchHit(row)]))
  }

  /** A document and its chunks in document order, or undefined if the path is not indexed. */
  documentChunks(path: string): StoredDocument | undefined {
    const document = this.#db
      .prepare('select id, path, url, title, doc_type from documents where path = ?')
      .get(path) as
      { id: number; path: string; url: string; title: string; doc_type: string } | undefined
    if (document === undefined) return undefined
    const rows = this.#db
      .prepare(
        `select id, ordinal, heading_path, anchor, block_types, text, context, metadata, token_count
         from chunks where doc_id = ? order by ordinal, pk`,
      )
      .all(document.id) as {
      id: string
      ordinal: number
      heading_path: string
      anchor: string
      block_types: string
      text: string
      context: string | null
      metadata: string
      token_count: number
    }[]
    return {
      path: document.path,
      url: document.url,
      title: document.title,
      docType: document.doc_type,
      chunks: rows.map((row) => ({
        chunkId: row.id,
        ordinal: row.ordinal,
        headingPath: parseStringArray(row.heading_path),
        anchor: row.anchor,
        blockTypes: parseStringArray(row.block_types),
        text: row.text,
        context: row.context,
        metadata: parseRecord(row.metadata),
        tokenCount: row.token_count,
      })),
    }
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
    const sql = vectorTableSql(dimensions)
    if (dropExisting) this.#db.exec('drop table if exists chunks_vec')
    this.#db.exec(sql)
  }

  /** FTS5 compares the keyword index with the chunks table; any drift throws. */
  #checkKeywordIndex(): void {
    try {
      this.#db
        .prepare("insert into chunks_fts (chunks_fts, rank) values ('integrity-check', 1)")
        .run()
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(`the keyword index does not match the chunks (${reason})`, { cause: error })
    }
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
           content_hash = excluded.content_hash,
           -- Keep the commit where the content last changed; a full rebuild
           -- rewrites unchanged documents with the new head.
           last_changed_sha = case when documents.content_hash = excluded.content_hash
                                   then documents.last_changed_sha
                                   else excluded.last_changed_sha end
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
    const insertVector = db.prepare(
      'insert into chunks_vec (rowid, doc_type, embedding) values (?, ?, ?)',
    )
    // Kept vectors carry the document's doc type too. Writing it on every sync
    // follows a changed type and repairs any drift, so --full always heals.
    const retypeVector = db.prepare('update chunks_vec set doc_type = ? where rowid = ?')
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
        insertVector.run(vecRowid(pk), doc.docType, chunk.vector)
      } else {
        retypeVector.run(doc.docType, vecRowid(pk))
      }
    }
  }

  #writeManifest(manifest: Manifest): void {
    this.#db
      .prepare(
        `insert into manifest (id, source_id, repo, branch, include_paths, commit_sha, synced_at, embed_model,
                               embed_dimensions, context_model, chunker_version, parser_version)
         values (1, @sourceId, @repo, @branch, @includePaths, @commitSha, @syncedAt, @embedModel,
                 @embedDimensions, @contextModel, @chunkerVersion, @parserVersion)
         on conflict (id) do update set
           source_id = excluded.source_id, repo = excluded.repo, branch = excluded.branch,
           include_paths = excluded.include_paths,
           commit_sha = excluded.commit_sha, synced_at = excluded.synced_at,
           embed_model = excluded.embed_model, embed_dimensions = excluded.embed_dimensions,
           context_model = excluded.context_model, chunker_version = excluded.chunker_version,
           parser_version = excluded.parser_version`,
      )
      .run({ ...manifest, includePaths: JSON.stringify(manifest.includePaths) })
  }
}

/** Opens data/sources/<source-id>.sqlite (or ':memory:'), migrating it if needed. */
export function openSourceIndex(path: string): SourceIndex {
  return new SourceIndex(openDatabase(path))
}
