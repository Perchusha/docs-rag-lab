import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  appendContext,
  contextsPath,
  readContexts,
  writeContexts,
  type ContextsHeader,
  type StoredContext,
} from './store.ts'

const header: ContextsHeader = {
  version: 1,
  model: 'claude-test',
  promptHash: 'abc',
  docsCommit: 'd'.repeat(40),
}
const entry = (chunkId: string): StoredContext => ({
  chunkId,
  textHash: `hash of ${chunkId}`,
  context: `Context of ${chunkId}.`,
})

let dir: string
let path: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'drl-contexts-'))
  path = join(dir, 'nested', 'file.jsonl')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('the contexts file', () => {
  it('lives under eval/contexts, named by the docs commit', () => {
    expect(contextsPath('/repo', 'typescript', 'abc').replaceAll('\\', '/')).toBe(
      '/repo/eval/contexts/typescript/abc.jsonl',
    )
  })

  it('holds a header, then one line per chunk in chunk ID order, however it was written', () => {
    writeContexts(path, header, [entry('b'), entry('a')])
    const [first, second, third, end] = readFileSync(path, 'utf8').split('\n')
    expect(JSON.parse(first ?? '')).toEqual(header)
    expect(JSON.parse(second ?? '')).toEqual(entry('a'))
    expect(JSON.parse(third ?? '')).toEqual(entry('b'))
    expect(end).toBe('')
  })

  it('reads back what was written and what was added since, for rebuilding without Claude', () => {
    writeContexts(path, header, [entry('a')])
    appendContext(path, entry('b'))
    expect(readContexts(path, header)).toEqual(
      new Map([
        ['a', entry('a')],
        ['b', entry('b')],
      ]),
    )
  })

  it('holds nothing when there is no file yet', () => {
    expect(readContexts(path, header).size).toBe(0)
  })

  it.each<[string, Partial<ContextsHeader>]>([
    ['another model', { model: 'other' }],
    ['another prompt', { promptHash: 'other' }],
    ['another docs commit', { docsCommit: 'other' }],
  ])('reuses nothing from %s', (_, change) => {
    writeContexts(path, header, [entry('a')])
    expect(readContexts(path, { ...header, ...change }).size).toBe(0)
  })

  it('names the line of a context it cannot read', () => {
    writeContexts(path, header, [entry('a')])
    writeFileSync(path, `${readFileSync(path, 'utf8')}{"chunkId":"b"}\n`)
    expect(() => readContexts(path, header)).toThrow(/file\.jsonl:3: a context needs/)
  })
})
