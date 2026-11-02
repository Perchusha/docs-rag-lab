// Resolves golden-set anchors against an index and checks them against the lock
// (SPEC sections 9 and 10, ADR-0009). An anchor matches a chunk of its document
// that contains the section, through the anchors the chunker recorded, and that
// contains the pinned passage if there is one. The lock records what each anchor
// resolved to when a human last reviewed the set, so a docs sync that changes the
// text under an expected answer is noticed even though the anchor still resolves.
import type { SourceIndex, StoredChunk } from '@docs-rag-lab/db'
import { CHUNKER_VERSION } from '@docs-rag-lab/source-kit'

import { anchorKey, GoldenSetError, type AnchorRef, type GoldenQuestion } from './golden.ts'

/** The part of the index anchors need; tests pass the real thing over an in-memory file. */
export type AnchorIndex = Pick<SourceIndex, 'getManifest' | 'documentChunks' | 'chunkHashes'>

/** Why an anchor does not resolve. */
export type AnchorProblem = 'no-document' | 'no-section' | 'no-passage'

export interface AnchorChunk {
  chunkId: string
  textHash: string
}

export type AnchorResolution =
  { chunks: AnchorChunk[]; problem?: undefined } | { chunks?: undefined; problem: AnchorProblem }

/** The anchors of the sections a chunk contains (metadata.anchors, chunker version 5). */
export function sectionAnchorsOf(chunk: Pick<StoredChunk, 'metadata'>): string[] {
  const { anchors } = chunk.metadata
  return Array.isArray(anchors) && anchors.every((anchor) => typeof anchor === 'string')
    ? anchors
    : []
}

/** The chunks an anchor matches, or why it matches none. Pure over the index. */
export function resolveAnchor(ref: AnchorRef, index: AnchorIndex): AnchorResolution {
  const [path = '', fragment] = ref.at.split('#')
  const document = index.documentChunks(path)
  if (document === undefined) return { problem: 'no-document' }
  const inSection =
    fragment === undefined
      ? document.chunks
      : document.chunks.filter((chunk) => sectionAnchorsOf(chunk).includes(fragment))
  if (inSection.length === 0) return { problem: 'no-section' }
  const { contains } = ref
  const matched =
    contains === undefined ? inSection : inSection.filter((chunk) => chunk.text.includes(contains))
  if (matched.length === 0) return { problem: 'no-passage' }
  const hashes = index.chunkHashes(path)
  return {
    chunks: matched.map((chunk) => ({
      chunkId: chunk.chunkId,
      textHash: hashes.get(chunk.chunkId) ?? '',
    })),
  }
}

/** What every anchor resolved to when the golden set was last reviewed. */
export interface GoldenLock {
  /** The version of the set, which is frozen: a changed file needs a new one (ADR-0009). */
  setVersion: number
  /** goldenSetHash of the file at that version. */
  setHash: string
  /** The docs commit of the index it was written from. */
  docsSha: string
  /** By anchorKey, sorted. */
  anchors: Record<string, AnchorChunk[]>
}

export interface AnchorFinding {
  questionId: string
  role: 'primary' | 'acceptable'
  anchor: AnchorRef
  /** changed: it resolves, to other text than the lock says. not-locked: the lock does not have it. */
  problem: AnchorProblem | 'changed' | 'not-locked'
}

export interface GoldenCheck {
  /** The version the lock records; 1 before there is a lock. */
  setVersion: number
  /** The file differs from that version. The set is frozen, so it needs a new one. */
  setChanged: boolean
  docsSha: string
  questions: number
  unanswerable: number
  /** Distinct anchors, across questions. */
  anchors: number
  /** Questions that cannot be scored, because an anchor they need is gone. Metrics leave them out. */
  stale: string[]
  /** Questions a human should read again. They are still scored. */
  review: string[]
  findings: AnchorFinding[]
  /**
   * The commit the lock was written from, when the index is at another one. The
   * anchors say nothing about text added elsewhere, which can still change an
   * answer. Unanswerable questions have no anchors at all, so they go to review.
   */
  docsMovedFrom: string | undefined
  /** What the anchors resolve to now: the lock to write once a human has reviewed them. */
  lock: GoldenLock
}

export interface CheckGoldenSetOptions {
  questions: readonly GoldenQuestion[]
  /** goldenSetHash of the file the questions came from. */
  setHash: string
  index: AnchorIndex
  lock: GoldenLock | undefined
}

/** Checks a golden set against an index built by this code. Throws if the index is not. */
export function checkGoldenSet(options: CheckGoldenSetOptions): GoldenCheck {
  const { questions, setHash, index, lock } = options
  const manifest = index.getManifest()
  if (manifest === undefined) {
    throw new GoldenSetError(['the index is empty: run drl sync first'])
  }
  if (manifest.chunkerVersion !== CHUNKER_VERSION) {
    throw new GoldenSetError([
      `the index was built with chunker version ${String(manifest.chunkerVersion)} and this code has ${String(CHUNKER_VERSION)}: run drl sync ${manifest.sourceId} --at ${manifest.commitSha}`,
    ])
  }

  const resolved = new Map<string, AnchorResolution>()
  const resolve = (ref: AnchorRef): AnchorResolution => {
    const key = anchorKey(ref)
    const known = resolved.get(key)
    if (known !== undefined) return known
    const resolution = resolveAnchor(ref, index)
    resolved.set(key, resolution)
    return resolution
  }

  const docsMoved = lock !== undefined && lock.docsSha !== manifest.commitSha
  const findings: AnchorFinding[] = []
  const stale: string[] = []
  const review: string[] = []
  for (const question of questions) {
    const before = findings.length
    const inspect = (role: AnchorFinding['role'], anchor: AnchorRef): boolean => {
      const { chunks, problem } = resolve(anchor)
      const report = (found: AnchorFinding['problem']): void => {
        findings.push({ questionId: question.id, role, anchor, problem: found })
      }
      if (problem !== undefined) {
        report(problem)
        return false
      }
      const locked = lock?.anchors[anchorKey(anchor)]
      if (locked === undefined) report('not-locked')
      else if (JSON.stringify(locked) !== JSON.stringify(chunks)) report('changed')
      return true
    }
    const missing = question.primary.filter((anchor) => !inspect('primary', anchor)).length
    for (const anchor of question.acceptable) inspect('acceptable', anchor)

    const goneForStale = question.primaryMatch === 'all' ? 1 : question.primary.length
    const anchorless = question.primary.length === 0
    if (missing >= goneForStale) stale.push(question.id)
    else if (findings.length > before || (anchorless && docsMoved)) review.push(question.id)
  }

  const entries = [...resolved.entries()].flatMap(([key, { chunks }]): [string, AnchorChunk[]][] =>
    chunks === undefined ? [] : [[key, chunks]],
  )
  const setVersion = lock?.setVersion ?? 1
  return {
    setVersion,
    setChanged: lock !== undefined && lock.setHash !== setHash,
    docsSha: manifest.commitSha,
    questions: questions.length,
    unanswerable: questions.filter((question) => question.tags.includes('unanswerable')).length,
    anchors: resolved.size,
    stale,
    review,
    findings,
    docsMovedFrom: docsMoved ? lock.docsSha : undefined,
    lock: {
      setVersion,
      setHash,
      docsSha: manifest.commitSha,
      anchors: Object.fromEntries(entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
    },
  }
}

function isAnchorChunk(value: unknown): value is AnchorChunk {
  if (typeof value !== 'object' || value === null) return false
  const { chunkId, textHash } = value as Partial<AnchorChunk>
  return typeof chunkId === 'string' && typeof textHash === 'string'
}

/** Reads a lock file, or throws a GoldenSetError. */
export function parseGoldenLock(text: string): GoldenLock {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new GoldenSetError(['the lock file is not valid JSON'])
  }
  if (typeof value === 'object' && value !== null) {
    const { setVersion, setHash, docsSha, anchors } = value as Partial<
      Record<keyof GoldenLock, unknown>
    >
    if (
      typeof setVersion === 'number' &&
      Number.isInteger(setVersion) &&
      setVersion > 0 &&
      typeof setHash === 'string' &&
      typeof docsSha === 'string' &&
      typeof anchors === 'object' &&
      anchors !== null &&
      Object.values(anchors).every(
        (chunks) => Array.isArray(chunks) && chunks.length > 0 && chunks.every(isAnchorChunk),
      )
    ) {
      return { setVersion, setHash, docsSha, anchors: anchors as GoldenLock['anchors'] }
    }
  }
  throw new GoldenSetError(['the lock file does not hold setVersion, setHash, docsSha and anchors'])
}
