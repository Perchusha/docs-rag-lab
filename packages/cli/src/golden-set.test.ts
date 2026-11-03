// The real golden sets, as CI can check them without an index: each file parses,
// and its lock covers exactly its anchors, so a question cannot be added or an
// anchor changed without running `drl eval check` on a real index. The CLI holds
// this test because sources may not import core.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  anchorKey,
  findRepoRoot,
  goldenSetHash,
  parseEvalTargets,
  parseGoldenLock,
  parseGoldenSet,
} from '@docs-rag-lab/core'
import { settings } from '@docs-rag-lab/settings'
import { describe, expect, it } from 'vitest'

import { goldenLockPath, goldenSetPath, goldenTargetsPath } from './golden.ts'
import { sourcesFor } from './run.ts'

const root = findRepoRoot(import.meta.dirname)

// A source gets its golden set after it gets its parser, so one without a set yet is fine.
const sourceIds = sourcesFor(settings)
  .map((source) => source.id)
  .filter((sourceId) => existsSync(goldenSetPath(root, sourceId)))

describe.each(sourceIds)('the %s golden set', (sourceId) => {
  const text = readFileSync(goldenSetPath(root, sourceId), 'utf8')
  const questions = parseGoldenSet(text)
  const lock = parseGoldenLock(readFileSync(goldenLockPath(root, sourceId), 'utf8'))

  it('has the 40 answerable questions SPEC section 13 asks for', () => {
    const answerable = questions.filter((question) => !question.tags.includes('unanswerable'))

    expect(answerable.length).toBeGreaterThanOrEqual(40)
  })

  it('locks exactly its anchors', () => {
    const anchors = questions.flatMap((question) => [...question.primary, ...question.acceptable])

    expect(Object.keys(lock.anchors).sort()).toEqual([...new Set(anchors.map(anchorKey))].sort())
  })

  it('matches its lock, because the set is frozen (ADR-0009)', () => {
    expect(lock.setHash).toBe(goldenSetHash(text))
  })

  it('has a changelog entry for its version in ADR-0009', () => {
    const adr = readFileSync(join(root, 'docs/adr/0009-golden-sets-and-anchors.md'), 'utf8')

    expect(adr).toContain(
      `| ${sourceId} | ${String(lock.setVersion)} | \`${lock.setHash.slice(0, 12)}\` |`,
    )
  })

  it('has targets that name anchors of its questions', () => {
    const path = goldenTargetsPath(root, sourceId)

    if (existsSync(path)) {
      expect(parseEvalTargets(readFileSync(path, 'utf8'), questions).length).toBeGreaterThan(0)
    }
  })

  it('records the commit its lock was written from', () => {
    expect(lock.docsSha).toMatch(/^[0-9a-f]{40}$/)
  })
})
