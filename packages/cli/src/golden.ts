// The golden set on disk (SPEC section 10): eval/questions.jsonl in the source's
// package, with the lock next to it. Core works on their contents. An earlier version
// stays beside it, byte for byte, once a later one replaces it (ADR-0017), so that a
// report can be checked against the set it names.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  archivedSetPath,
  archivedSets,
  checkGoldenSet,
  goldenSetHash,
  goldenSetPath,
  goldenSetPathFor,
  parseGoldenLock,
  parseGoldenSet,
  type AnchorIndex,
  type GoldenCheck,
  type GoldenLock,
  type GoldenQuestion,
  type IndexVariant,
} from '@docs-rag-lab/core'

import { CliError } from './errors.ts'

function evalDir(root: string, sourceId: string): string {
  return join(root, 'packages', 'sources', sourceId, 'eval')
}

export { archivedSetPath, archivedSets, goldenSetPath }

/** A set Claude drafted, until a human has reviewed its flagged questions (ADR-0015). */
export function goldenDraftPath(root: string, sourceId: string): string {
  return join(evalDir(root, sourceId), 'questions.draft.jsonl')
}

/**
 * The compiled index has chunks of its own, so it keeps a lock of its own (ADR-0017). The indexes
 * whose chunks carry a prefix share the plain index's chunks, and its lock.
 */
const ownLock = (variant: IndexVariant | undefined): boolean => variant === 'compiled'

/** The lock beside a set file: `questions.lock.json`, or `questions.compiled.lock.json`. */
function lockPathOf(setPath: string, variant: IndexVariant | undefined): string {
  return setPath.replace(/\.jsonl$/, ownLock(variant) ? '.compiled.lock.json' : '.lock.json')
}

export function goldenLockPath(root: string, sourceId: string, variant?: IndexVariant): string {
  return lockPathOf(goldenSetPath(root, sourceId), variant)
}

export function goldenTargetsPath(root: string, sourceId: string): string {
  return join(evalDir(root, sourceId), 'targets.json')
}

/**
 * The set file to read: the current one, or the version with the hash a report names. A hash that
 * no file has is an error, since the report could then be checked against another set.
 */
function setPathFor(root: string, sourceId: string, setHash: string | undefined): string {
  if (setHash === undefined) return goldenSetPath(root, sourceId)
  const found = goldenSetPathFor(root, sourceId, setHash)
  if (found === undefined) {
    throw new CliError(
      `no version of the ${sourceId} golden set has the hash ${setHash.slice(0, 12)} that this report names`,
    )
  }
  return found
}

export interface GoldenFilesOptions {
  /** The set a report names, by its hash. Without it, the current set. */
  setHash?: string | undefined
  /** The index the set is checked against, which says which lock to read. */
  variant?: IndexVariant | undefined
}

/** The golden set and its check against the index, or undefined when the source has none yet. */
export function readGoldenFiles(
  root: string,
  sourceId: string,
  index: AnchorIndex,
  options: GoldenFilesOptions = {},
): { questions: GoldenQuestion[]; check: GoldenCheck } | undefined {
  if (options.setHash === undefined && !existsSync(goldenSetPath(root, sourceId))) return undefined
  const setPath = setPathFor(root, sourceId, options.setHash)
  const lockPath = lockPathOf(setPath, options.variant)
  const text = readFileSync(setPath, 'utf8')
  const questions = parseGoldenSet(text)
  const check = checkGoldenSet({
    questions,
    setHash: goldenSetHash(text),
    index,
    lock: existsSync(lockPath) ? parseGoldenLock(readFileSync(lockPath, 'utf8')) : undefined,
  })
  return { questions, check }
}

/** The lock of a set file, when it has one: the plain index's, or the compiled index's. */
export function readGoldenLock(
  root: string,
  sourceId: string,
  options: GoldenFilesOptions = {},
): GoldenLock | undefined {
  const path = lockPathOf(setPathFor(root, sourceId, options.setHash), options.variant)
  return existsSync(path) ? parseGoldenLock(readFileSync(path, 'utf8')) : undefined
}

/** The golden set checked against the index, or undefined when the source has none yet. */
export function checkGoldenFiles(
  root: string,
  sourceId: string,
  index: AnchorIndex,
  options: GoldenFilesOptions = {},
): GoldenCheck | undefined {
  return readGoldenFiles(root, sourceId, index, options)?.check
}

/** Formatted as Prettier would, so a rewrite of the lock shows only what changed. */
export function writeGoldenLock(
  root: string,
  sourceId: string,
  lock: GoldenLock,
  variant?: IndexVariant,
): void {
  writeFileSync(goldenLockPath(root, sourceId, variant), `${JSON.stringify(lock, null, 2)}\n`)
}
