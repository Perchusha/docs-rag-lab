// The golden set on disk (SPEC section 10): eval/questions.jsonl in the source's
// package, with the lock next to it. Core works on their contents.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  checkGoldenSet,
  parseGoldenLock,
  parseGoldenSet,
  type AnchorIndex,
  type GoldenCheck,
  type GoldenLock,
} from '@docs-rag-lab/core'

function evalDir(root: string, sourceId: string): string {
  return join(root, 'packages', 'sources', sourceId, 'eval')
}

export function goldenSetPath(root: string, sourceId: string): string {
  return join(evalDir(root, sourceId), 'questions.jsonl')
}

export function goldenLockPath(root: string, sourceId: string): string {
  return join(evalDir(root, sourceId), 'questions.lock.json')
}

/** The golden set checked against the index, or undefined when the source has none yet. */
export function checkGoldenFiles(
  root: string,
  sourceId: string,
  index: AnchorIndex,
): GoldenCheck | undefined {
  const setPath = goldenSetPath(root, sourceId)
  if (!existsSync(setPath)) return undefined
  const lockPath = goldenLockPath(root, sourceId)
  return checkGoldenSet({
    questions: parseGoldenSet(readFileSync(setPath, 'utf8')),
    index,
    lock: existsSync(lockPath) ? parseGoldenLock(readFileSync(lockPath, 'utf8')) : undefined,
  })
}

/** Formatted as Prettier would, so a rewrite of the lock shows only what changed. */
export function writeGoldenLock(root: string, sourceId: string, lock: GoldenLock): void {
  writeFileSync(goldenLockPath(root, sourceId), `${JSON.stringify(lock, null, 2)}\n`)
}
