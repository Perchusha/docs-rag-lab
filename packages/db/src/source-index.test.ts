import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  openSourceIndex,
  type ChunkWrite,
  type DocumentWrite,
  type Manifest,
  type SourceIndex,
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
    expect(hits[0]).toMatchObject({
      distance: 0,
      headingPath: ['Section', 'a1'],
      url: 'https://example.com/a',
      title: 'A',
      docType: 'handbook',
      metadata: { spans: [[0, 'text of a1'.length]] },
    })
    expect(hits[1]?.docType).toBe('reference')
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
})
