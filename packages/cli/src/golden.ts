// The golden set on disk (SPEC section 10): eval/questions.jsonl in the source's
// package, with the lock next to it. Core works on their contents.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  checkGoldenSet,
  goldenSetHash,
  goldenSetPath,
  parseGoldenLock,
  parseGoldenSet,
  type AnchorIndex,
  type GoldenCheck,
  type GoldenLock,
  type GoldenQuestion,
} from '@docs-rag-lab/core'

function evalDir(root: string, sourceId: string): string {
  return join(root, 'packages', 'sources', sourceId, 'eval')
}

export { goldenSetPath }

/** A set Claude drafted, until a human has reviewed its flagged questions (ADR-0015). */
export function goldenDraftPath(root: string, sourceId: string): string {
  return join(evalDir(root, sourceId), 'questions.draft.jsonl')
}

export function goldenLockPath(root: string, sourceId: string): string {
  return join(evalDir(root, sourceId), 'questions.lock.json')
}

export function goldenTargetsPath(root: string, sourceId: string): string {
  return join(evalDir(root, sourceId), 'targets.json')
}

/** The golden set and its check against the index, or undefined when the source has none yet. */
export function readGoldenFiles(
  root: string,
  sourceId: string,
  index: AnchorIndex,
): { questions: GoldenQuestion[]; check: GoldenCheck } | undefined {
  const setPath = goldenSetPath(root, sourceId)
  if (!existsSync(setPath)) return undefined
  const lockPath = goldenLockPath(root, sourceId)
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

/** The golden set checked against the index, or undefined when the source has none yet. */
export function checkGoldenFiles(
  root: string,
  sourceId: string,
  index: AnchorIndex,
): GoldenCheck | undefined {
  return readGoldenFiles(root, sourceId, index)?.check
}

/** Formatted as Prettier would, so a rewrite of the lock shows only what changed. */
export function writeGoldenLock(root: string, sourceId: string, lock: GoldenLock): void {
  writeFileSync(goldenLockPath(root, sourceId), `${JSON.stringify(lock, null, 2)}\n`)
}
