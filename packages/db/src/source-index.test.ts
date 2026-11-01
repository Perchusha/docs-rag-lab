import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { migrate, openDatabase } from './open.ts'
import {
  openSourceIndex,
  SOURCE_INDEX_MIGRATIONS,
  SourceIndex,
  type ChunkWrite,
  type DocumentWrite,
  type Manifest,
} from './source-index.ts'

const DIMS = 4

const manifest = (overrides: Partial<Manifest> = {}): Manifest => ({
  sourceId: 'demo',
  repo: 'file:///demo',
  branch: 'main',
  includePaths: ['docs'],
  commitSha: 'a'.repeat(40),
  syncedAt: '2026-10-31T00:00:00.000Z',
  embedModel: 'fake:model:4',
  embedDimensions: DIMS,
  contextModel: null,
  chunkerVersion: 1,
  parserVersion: 1,
  ...overrides,
})

const chunk = (id: string, vector?: number[], text = `text of ${id}`): ChunkWrite => ({
  id,
  ordinal: 0,
  headingPath: ['Section', id],
  anchor: id,
  blockTypes: ['prose'],
  text,
  metadata: { spans: [[0, text.length]] },
  tokenCount: 3,
  textHash: `hash-${text}`,
  vector: vector === undefined ? undefined : new Float32Array(vector),
})

const doc = (path: string, chunks: ChunkWrite[], docType = 'handbook'): DocumentWrite => ({
  path,
  url: `https://example.com/${path}`,
  title: path.toUpperCase(),
  docType,
  contentHash: `content-${path}`,
  lastChangedSha: 'a'.repeat(40),
  chunks,
})

let index: SourceIndex | undefined
let tempDir: string | undefined

afterEach(() => {
  index?.close()
  index = undefined
  if (tempDir !== undefined) rmSync(tempDir, { recursive: true, force: true })
  tempDir = undefined
})

function memoryIndex(): SourceIndex {
  index = openSourceIndex(':memory:')
  return index
}

describe('SourceIndex', () => {
  it('migrates a new file and reopens it without migrating again', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'drl-db-'))
    const path = join(tempDir, 'demo.sqlite')
    const first = openSourceIndex(path)
    first.applyChanges({
      documents: [doc('a', [chunk('a1', [1, 0, 0, 0])])],
      deletePaths: [],
      manifest: manifest(),
    })
    first.close()

    index = openSourceIndex(path)
    expect(index.getManifest()).toMatchObject({ commitSha: 'a'.repeat(40), includePaths: ['docs'] })
    expect(index.stats().chunks).toBe(1)
  })

  it('has no manifest and no vector table before the first sync', () => {
    const idx = memoryIndex()
    expect(idx.getManifest()).toBeUndefined()
    expect(idx.hasVectorTable()).toBe(false)
  })

  it('writes documents, chunks and vectors, and finds the nearest chunks first', () => {
    const idx = memoryIndex()
    idx.applyChanges({
      documents: [
        doc('a', [chunk('a1', [1, 0, 0, 0]), chunk('a2', [0, 1, 0, 0])]),
        doc('b', [chunk('b1', [0.9, 0.1, 0, 0])], 'reference'),
      ],
      deletePaths: [],
      manifest: manifest(),
    })

    const hits = idx.searchVectors(new Float32Array([1, 0, 0, 0]), 2)
    expect(hits.map((hit) => hit.chunkId)).toEqual(['a1', 'b1'])
    expect(hits[0]?.score).toBeCloseTo(0, 6)
    const records = idx.chunksById(['a1', 'b1', 'missing'])
    expect([...records.keys()].sort()).toEqual(['a1', 'b1'])
    expect(records.get('a1')).toMatchObject({
      headingPath: ['Section', 'a1'],
      url: 'https://example.com/a',
      title: 'A',
      docType: 'handbook',
      metadata: { spans: [[0, 'text of a1'.length]] },
    })
    expect(records.get('b1')?.docType).toBe('reference')
  })

  it('keeps unchanged vectors, replaces changed ones and deletes dropped chunks', () => {
    const idx = memoryIndex()
    idx.applyChanges({
      documents: [doc('a', [chunk('a1', [1, 0, 0, 0]), chunk('a2', [0, 1, 0, 0])])],
      deletePaths: [],
      manifest: manifest(),
    })

    // a1 unchanged (no vector given), a2 dropped, a3 new.
    idx.applyChanges({
      documents: [doc('a', [chunk('a1'), chunk('a3', [0, 0, 1, 0])])],
      deletePaths: [],
      manifest: manifest({ commitSha: 'b'.repeat(40) }),
    })

    expect([...idx.chunkHashes('a').keys()].sort()).toEqual(['a1', 'a3'])
    expect(idx.searchVectors(new Float32Array([1, 0, 0, 0]), 1)[0]?.chunkId).toBe('a1')
    expect(idx.searchVectors(new Float32Array([0, 0, 1, 0]), 1)[0]?.chunkId).toBe('a3')
    expect(
      idx.searchVectors(new Float32Array([0, 1, 0, 0]), 3).map((hit) => hit.chunkId),
    ).not.toContain('a2')
    expect(idx.getManifest()?.commitSha).toBe('b'.repeat(40))
  })

  it('deletes a document with its chunks and vectors', () => {
    const idx = memoryIndex()
    idx.applyChanges({
      documents: [doc('a', [chunk('a1', [1, 0, 0, 0])]), doc('b', [chunk('b1', [0, 1, 0, 0])])],
      deletePaths: [],
      manifest: manifest(),
    })
    idx.applyChanges({ documents: [], deletePaths: ['b', 'missing'], manifest: manifest() })

    expect(idx.documentPaths()).toEqual(['a'])
    expect(idx.stats()).toMatchObject({ documents: 1, chunks: 1 })
    expect(idx.searchVectors(new Float32Array([0, 1, 0, 0]), 5).map((hit) => hit.chunkId)).toEqual([
      'a1',
    ])
  })

  it('rolls back the whole sync when a new chunk has no vector', () => {
    const idx = memoryIndex()
    idx.applyChanges({
      documents: [doc('a', [chunk('a1', [1, 0, 0, 0])])],
      deletePaths: [],
      manifest: manifest(),
    })

    expect(() => {
      idx.applyChanges({
        documents: [doc('b', [chunk('b1')])],
        deletePaths: ['a'],
        manifest: manifest({ commitSha: 'c'.repeat(40) }),
      })
    }).toThrow(/0 vectors|1 chunks but/)

    expect(idx.documentPaths()).toEqual(['a'])
    expect(idx.getManifest()?.commitSha).toBe('a'.repeat(40))
  })

  it('recreates the vector table when the dimensions change', () => {
    const idx = memoryIndex()
    idx.applyChanges({
      documents: [doc('a', [chunk('a1', [1, 0, 0, 0])])],
      deletePaths: [],
      manifest: manifest(),
    })

    idx.applyChanges({
      documents: [doc('a', [chunk('a1', [1, 0])])],
      deletePaths: [],
      manifest: manifest({ embedModel: 'fake:model:2', embedDimensions: 2 }),
      resetVectors: 2,
    })

    expect(idx.searchVectors(new Float32Array([1, 0]), 1)[0]?.chunkId).toBe('a1')
    expect(idx.getManifest()?.embedDimensions).toBe(2)
  })

  it('rejects a vector with the wrong number of dimensions', () => {
    const idx = memoryIndex()
    expect(() => {
      idx.applyChanges({
        documents: [doc('a', [chunk('a1', [1, 0])])],
        deletePaths: [],
        manifest: manifest(),
      })
    }).toThrow()
    expect(idx.stats().chunks).toBe(0)
  })

  it('keeps the commit where a document last changed when its content is the same', () => {
    const idx = memoryIndex()
    idx.applyChanges({
      documents: [doc('a', [chunk('a1', [1, 0, 0, 0])])],
      deletePaths: [],
      manifest: manifest(),
    })

    // A full rebuild at a new head rewrites the unchanged document.
    const same = { ...doc('a', [chunk('a1')]), lastChangedSha: 'b'.repeat(40) }
    idx.applyChanges({ documents: [same], deletePaths: [], manifest: manifest() })
    expect(idx.documentVersion('a')?.lastChangedSha).toBe('a'.repeat(40))

    const edited = { ...same, contentHash: 'content-a-edited', lastChangedSha: 'c'.repeat(40) }
    idx.applyChanges({ documents: [edited], deletePaths: [], manifest: manifest() })
    expect(idx.documentVersion('a')).toEqual({
      contentHash: 'content-a-edited',
      lastChangedSha: 'c'.repeat(40),
    })
    expect(idx.documentVersion('missing')).toBeUndefined()
  })

  it('refuses a sync that leaves a chunk without a vector, and says how many', () => {
    const idx = memoryIndex()
    idx.applyChanges({
      documents: [doc('a', [chunk('a1', [1, 0, 0, 0])]), doc('b', [chunk('b1', [0, 1, 0, 0])])],
      deletePaths: [],
      manifest: manifest(),
    })

    // b2 is new but comes without a vector. The check counts chunks without a
    // vector directly, not only the totals.
    expect(() => {
      idx.applyChanges({
        documents: [doc('b', [chunk('b2')])],
        deletePaths: [],
        manifest: manifest({ commitSha: 'd'.repeat(40) }),
      })
    }).toThrow(/chunks without one/)
    expect([...idx.chunkHashes('b').keys()]).toEqual(['b1'])
  })

  it('reports totals per doc type', () => {
    const idx = memoryIndex()
    idx.applyChanges({
      documents: [
        doc('a', [chunk('a1', [1, 0, 0, 0]), chunk('a2', [0, 1, 0, 0])]),
        doc('b', [chunk('b1', [0, 0, 1, 0])], 'release-notes'),
      ],
      deletePaths: [],
      manifest: manifest(),
    })

    expect(idx.stats()).toEqual({
      documents: 2,
      chunks: 3,
      tokens: 9,
      byDocType: [
        { docType: 'handbook', documents: 1, chunks: 2, tokens: 6 },
        { docType: 'release-notes', documents: 1, chunks: 1, tokens: 3 },
      ],
    })
  })

  it('stores the parser version in the manifest', () => {
    const idx = memoryIndex()
    idx.applyChanges({
      documents: [doc('a', [chunk('a1', [1, 0, 0, 0])])],
      deletePaths: [],
      manifest: manifest({ parserVersion: 3 }),
    })
    expect(idx.getManifest()?.parserVersion).toBe(3)
  })
})

describe('SourceIndex keyword search', () => {
  const ids = (idx: SourceIndex, query: string, docTypes?: string[]) =>
    idx.searchKeywords(query, 10, { docTypes }).map((hit) => hit.chunkId)

  it('follows every write path: inserts, upserts, dropped chunks and deleted documents', () => {
    const idx = memoryIndex()
    idx.applyChanges({
      documents: [
        doc('a', [chunk('a1', [1, 0, 0, 0], 'alpha noUncheckedIndexedAccess')]),
        doc('b', [chunk('b1', [0, 1, 0, 0], 'beta skipLibCheck')]),
      ],
      deletePaths: [],
      manifest: manifest(),
    })
    expect(ids(idx, '"alpha"')).toEqual(['a1'])

    // a1's text changes (upsert), a2 is added; then a2 is dropped and b deleted.
    idx.applyChanges({
      documents: [
        doc('a', [
          chunk('a1', [1, 0, 0, 0], 'gamma only'),
          chunk('a2', [0, 0, 1, 0], 'delta text'),
        ]),
      ],
      deletePaths: [],
      manifest: manifest(),
    })
    expect(ids(idx, '"alpha"')).toEqual([])
    expect(ids(idx, '"gamma" OR "delta"').sort()).toEqual(['a1', 'a2'])

    idx.applyChanges({
      documents: [doc('a', [chunk('a1', undefined, 'gamma only')])],
      deletePaths: ['b'],
      manifest: manifest(),
    })
    expect(ids(idx, '"delta"')).toEqual([])
    expect(ids(idx, '"skiplib"')).toEqual([])
    expect(ids(idx, '"gamma"')).toEqual(['a1'])
  })

  it('matches substrings case-insensitively, also in the heading path, best first', () => {
    const idx = memoryIndex()
    idx.applyChanges({
      documents: [
        doc('a', [
          chunk(
            'a1',
            [1, 0, 0, 0],
            'Turn on noUncheckedIndexedAccess. Unchecked access is unchecked.',
          ),
          chunk('a2', [0, 1, 0, 0], 'An unrelated paragraph about modules.'),
        ]),
      ],
      deletePaths: [],
      manifest: manifest(),
    })

    const hits = idx.searchKeywords('"unchecked" OR "modules"', 10)
    expect(hits.map((hit) => hit.chunkId)).toEqual(['a1', 'a2'])
    expect(hits[0]?.score).toBeGreaterThan(hits[1]?.score ?? Infinity)
    // headingPath is ['Section', id]
    expect(ids(idx, '"section"').sort()).toEqual(['a1', 'a2'])
  })

  it('leaves the keyword index alone when a sync rewrites unchanged chunks', () => {
    const db = openDatabase(':memory:')
    index = new SourceIndex(db)
    const write = () => {
      index?.applyChanges({
        documents: [doc('a', [chunk('a1', [1, 0, 0, 0], 'same text'), chunk('a2', [0, 1, 0, 0])])],
        deletePaths: [],
        manifest: manifest(),
      })
    }
    const segments = () =>
      (db.prepare('select count(*) as n from chunks_fts_data').get() as { n: number }).n
    write()
    const before = segments()

    // A full rebuild upserts every chunk again with the same text.
    write()
    write()
    expect(segments()).toBe(before)

    index.applyChanges({
      documents: [doc('a', [chunk('a1', [1, 0, 0, 0], 'new text')])],
      deletePaths: [],
      manifest: manifest(),
    })
    expect(index.searchKeywords('"new text"', 5).map((hit) => hit.chunkId)).toEqual(['a1'])
    expect(index.searchKeywords('"same"', 5)).toEqual([])
  })

  it('throws on an invalid FTS5 query instead of guessing', () => {
    const idx = memoryIndex()
    idx.applyChanges({
      documents: [doc('a', [chunk('a1', [1, 0, 0, 0])])],
      deletePaths: [],
      manifest: manifest(),
    })
    expect(() => idx.searchKeywords('"unterminated', 10)).toThrow()
  })

  it('refuses a sync that would leave the keyword index out of step with the chunks', () => {
    const db = openDatabase(':memory:')
    index = new SourceIndex(db)
    index.applyChanges({
      documents: [doc('a', [chunk('a1', [1, 0, 0, 0])])],
      deletePaths: [],
      manifest: manifest(),
    })
    db.exec('drop trigger chunks_fts_insert')

    expect(() =>
      index?.applyChanges({
        documents: [doc('b', [chunk('b1', [0, 1, 0, 0])])],
        deletePaths: [],
        manifest: manifest(),
      }),
    ).toThrow(/keyword index does not match/)
    expect(index.documentPaths()).toEqual(['a'])
  })
})

describe('SourceIndex filters', () => {
  function seeded(): SourceIndex {
    const idx = memoryIndex()
    idx.applyChanges({
      documents: [
        doc('h', [chunk('h1', [1, 0, 0, 0], 'shared word one')], 'handbook'),
        doc(
          'o',
          [
            chunk('o1', [0.8, 0.2, 0, 0], 'shared word two'),
            chunk('o2', [0.1, 0.9, 0, 0], 'shared word three'),
          ],
          'option',
        ),
        doc('r', [chunk('r1', [0.99, 0.01, 0, 0], 'shared word four')], 'release-notes'),
      ],
      deletePaths: [],
      manifest: manifest(),
    })
    return idx
  }

  it('filters vector search by doc type inside the KNN query, so k results still come back', () => {
    const idx = seeded()
    const query = new Float32Array([1, 0, 0, 0])
    expect(idx.searchVectors(query, 2).map((hit) => hit.chunkId)).toEqual(['h1', 'r1'])
    expect(idx.searchVectors(query, 2, { docTypes: ['option'] }).map((hit) => hit.chunkId)).toEqual(
      ['o1', 'o2'],
    )
    expect(
      idx.searchVectors(query, 3, { docTypes: ['option', 'handbook'] }).map((hit) => hit.chunkId),
    ).toEqual(['h1', 'o1', 'o2'])
    expect(idx.searchVectors(query, 5, { docTypes: [] })).toHaveLength(4)
    // 'release-notes' is longer than the 12 bytes vec0 stores inline for text metadata.
    expect(
      idx.searchVectors(query, 5, { docTypes: ['release-notes'] }).map((hit) => hit.chunkId),
    ).toEqual(['r1'])
    expect(
      idx.searchVectors(query, 5, { docTypes: ['release-notes', 'option'] }).map((h) => h.chunkId),
    ).toEqual(['r1', 'o1', 'o2'])
  })

  it('filters keyword search by doc type', () => {
    const idx = seeded()
    const found = (docTypes: string[]) =>
      idx
        .searchKeywords('"shared"', 10, { docTypes })
        .map((hit) => hit.chunkId)
        .sort()
    expect(found(['option'])).toEqual(['o1', 'o2'])
    expect(found(['handbook', 'release-notes'])).toEqual(['h1', 'r1'])
    expect(found([])).toEqual(['h1', 'o1', 'o2', 'r1'])
  })

  it('moves kept vectors to the new doc type when a document changes type', () => {
    const idx = seeded()
    // o keeps its chunks and vectors (no vector given) but becomes a reference doc.
    idx.applyChanges({
      documents: [doc('o', [chunk('o1'), chunk('o2')], 'reference')],
      deletePaths: [],
      manifest: manifest(),
    })
    const query = new Float32Array([1, 0, 0, 0])
    expect(idx.searchVectors(query, 5, { docTypes: ['option'] })).toEqual([])
    expect(
      idx.searchVectors(query, 5, { docTypes: ['reference'] }).map((hit) => hit.chunkId),
    ).toEqual(['o1', 'o2'])
  })

  it('refuses a stale vector doc type, and rewriting the document repairs it', () => {
    const db = openDatabase(':memory:')
    index = new SourceIndex(db)
    const write = (docs: DocumentWrite[]) => {
      index?.applyChanges({ documents: docs, deletePaths: [], manifest: manifest() })
    }
    write([doc('a', [chunk('a1', [1, 0, 0, 0])]), doc('b', [chunk('b1', [0, 1, 0, 0])])])
    db.prepare("update chunks_vec set doc_type = 'other' where rowid = 1").run()

    // A sync that does not touch a still finds the drift and rolls back.
    expect(() => {
      write([doc('b', [chunk('b1')])])
    }).toThrow(/1 vectors carry a stale doc type/)
    // A sync that rewrites a (a full re-parse does) puts its type back.
    write([doc('a', [chunk('a1')])])
    expect(
      index.searchVectors(new Float32Array([1, 0, 0, 0]), 1, { docTypes: ['handbook'] })[0]
        ?.chunkId,
    ).toBe('a1')
  })
})

describe('SourceIndex migration 2', () => {
  it('copies the stored vectors into the new table, builds the keyword index and keeps everything else', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'drl-db-'))
    const path = join(tempDir, 'v1.sqlite')
    const vectors = [new Float32Array([1, 0, 0, 0]), new Float32Array([0.6, 0.8, 0, 0])]

    // A version 1 file as M1 wrote it.
    const v1 = openDatabase(path)
    migrate(v1, SOURCE_INDEX_MIGRATIONS.slice(0, 1))
    v1.exec(`
      insert into manifest values (1, 'demo', 'file:///demo', 'main', '["docs"]', '${'a'.repeat(40)}',
        '2026-10-31T00:00:00.000Z', 'fake:model:4', 4, null, 2);
      insert into documents values (1, 'a.md', 'https://example.com/a', 'A', 'option', 'h', 's');
      insert into chunks values
        (1, 'c1', 1, 0, '["Strict"]', 'strict', '["prose"]', 'turn on strictNullChecks', null, '{}', 4, 'x'),
        (2, 'c2', 1, 1, '["Other"]', 'other', '["prose"]', 'something else', null, '{}', 3, 'y');
      create virtual table chunks_vec using vec0(embedding float[4] distance_metric=cosine);
    `)
    const insert = v1.prepare('insert into chunks_vec (rowid, embedding) values (?, ?)')
    vectors.forEach((vector, i) => insert.run(BigInt(i + 1), vector))
    v1.close()

    const db = openDatabase(path)
    index = new SourceIndex(db)
    expect(db.pragma('user_version', { simple: true })).toBe(SOURCE_INDEX_MIGRATIONS.length)
    expect(index.getManifest()).toMatchObject({ chunkerVersion: 2, parserVersion: null })

    // The same bytes, now with the doc type next to them.
    const rows = db
      .prepare('select rowid, doc_type, embedding from chunks_vec order by rowid')
      .all() as {
      rowid: number
      doc_type: string
      embedding: Buffer
    }[]
    expect(rows.map((row) => row.doc_type)).toEqual(['option', 'option'])
    rows.forEach((row, i) => {
      expect(
        Buffer.compare(row.embedding, Buffer.from(vectors[i]?.buffer ?? new ArrayBuffer(0))),
      ).toBe(0)
    })

    expect(index.searchKeywords('"nullcheck"', 5).map((hit) => hit.chunkId)).toEqual(['c1'])
    expect(
      index.searchVectors(new Float32Array([1, 0, 0, 0]), 1, { docTypes: ['option'] })[0]?.chunkId,
    ).toBe('c1')
    // The next sync passes every invariant, including the keyword index check.
    index.applyChanges({ documents: [], deletePaths: [], manifest: manifest() })
    expect(index.stats().chunks).toBe(2)
  })

  it('migrates a version 1 file that never got a vector table', () => {
    const db = openDatabase(':memory:')
    migrate(db, SOURCE_INDEX_MIGRATIONS.slice(0, 1))
    index = new SourceIndex(db)
    expect(index.hasVectorTable()).toBe(false)
    expect(index.searchKeywords('"anything"', 5)).toEqual([])
  })
})

describe('SourceIndex documentChunks', () => {
  // The chunk helper writes ordinal 0; give each chunk its place in the document.
  const inOrder = (chunks: ChunkWrite[]): ChunkWrite[] =>
    chunks.map((c, ordinal) => ({ ...c, ordinal }))

  it('returns a document with its chunks in document order', () => {
    const idx = memoryIndex()
    // IDs that sort differently from the document order.
    const chunks = inOrder([
      chunk('z', [1, 0, 0, 0]),
      chunk('a', [0, 1, 0, 0]),
      chunk('m', [0, 0, 1, 0]),
    ])
    idx.applyChanges({ documents: [doc('d', chunks)], deletePaths: [], manifest: manifest() })

    const stored = idx.documentChunks('d')
    expect(stored).toMatchObject({ path: 'd', url: 'https://example.com/d', title: 'D' })
    expect(stored?.chunks.map((c) => [c.chunkId, c.ordinal])).toEqual([
      ['z', 0],
      ['a', 1],
      ['m', 2],
    ])
    expect(stored?.chunks[0]).toMatchObject({
      headingPath: ['Section', 'z'],
      blockTypes: ['prose'],
      text: 'text of z',
      context: null,
      metadata: { spans: [[0, 9]] },
    })
    expect(idx.documentChunks('missing')).toBeUndefined()
  })

  it('follows a chunk inserted in the middle, and a move does not touch the keyword index', () => {
    const db = openDatabase(':memory:')
    index = new SourceIndex(db)
    const segments = () =>
      (db.prepare('select count(*) as n from chunks_fts_data').get() as { n: number }).n
    const write = (chunks: ChunkWrite[]) => {
      index?.applyChanges({
        documents: [doc('d', inOrder(chunks))],
        deletePaths: [],
        manifest: manifest(),
      })
    }
    write([chunk('first', [1, 0, 0, 0]), chunk('last', [0, 1, 0, 0])])
    write([chunk('first'), chunk('middle', [0, 0, 1, 0]), chunk('last')])
    expect(index.documentChunks('d')?.chunks.map((c) => c.chunkId)).toEqual([
      'first',
      'middle',
      'last',
    ])

    // Moving a kept chunk changes only its ordinal, which the FTS trigger ignores.
    const before = segments()
    write([chunk('last'), chunk('first'), chunk('middle')])
    expect(segments()).toBe(before)
    expect(index.documentChunks('d')?.chunks.map((c) => c.chunkId)).toEqual([
      'last',
      'first',
      'middle',
    ])
  })
})
