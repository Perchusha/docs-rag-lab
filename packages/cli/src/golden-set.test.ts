// The real golden sets, as CI can check them without an index: each file parses,
// and its lock covers exactly its anchors, so a question cannot be added or an
// anchor changed without running `drl eval check` on a real index. The CLI holds
// this test because sources may not import core.
import { readFileSync } from 'node:fs'

import { anchorKey, findRepoRoot, parseGoldenLock, parseGoldenSet } from '@docs-rag-lab/core'
import { settings } from '@docs-rag-lab/settings'
import { describe, expect, it } from 'vitest'

import { goldenLockPath, goldenSetPath } from './golden.ts'
import { sourcesFor } from './run.ts'

const root = findRepoRoot(import.meta.dirname)

describe.each(sourcesFor(settings).map((source) => source.id))('the %s golden set', (sourceId) => {
  const questions = parseGoldenSet(readFileSync(goldenSetPath(root, sourceId), 'utf8'))
  const lock = parseGoldenLock(readFileSync(goldenLockPath(root, sourceId), 'utf8'))

  it('has the 40 answerable questions SPEC section 13 asks for', () => {
    const answerable = questions.filter((question) => !question.tags.includes('unanswerable'))

    expect(answerable.length).toBeGreaterThanOrEqual(40)
  })

  it('locks exactly its anchors', () => {
    const anchors = questions.flatMap((question) => [...question.primary, ...question.acceptable])

    expect(Object.keys(lock.anchors).sort()).toEqual([...new Set(anchors.map(anchorKey))].sort())
  })

  it('records the commit its lock was written from', () => {
    expect(lock.docsSha).toMatch(/^[0-9a-f]{40}$/)
  })
})
