import { describe, expect, it } from 'vitest'

import { EM_DASH, findEmDashes, isBinary, isChecked } from './em-dash.ts'

const EN_DASH = String.fromCodePoint(0x2013)

describe('isChecked, for eval reports', () => {
  it('leaves out the JSON of a report, which is recorded data', () => {
    expect(isChecked('eval/reports/typescript/2026-11-03-abc-baseline.json')).toBe(false)
    expect(isChecked('eval/reports/typescript/dev/run.json')).toBe(false)
  })

  it('still checks its markdown, and JSON anywhere else', () => {
    expect(isChecked('eval/reports/typescript/2026-11-03-abc-baseline.md')).toBe(true)
    expect(isChecked('eval/questions.json')).toBe(true)
    expect(isChecked('packages/eval/reports/typescript/run.json')).toBe(true)
  })
})

describe('findEmDashes', () => {
  it('reports the line and column of each em dash', () => {
    const text = ['first line', `a ${EM_DASH} b ${EM_DASH} c`, EM_DASH].join('\n')

    expect(findEmDashes(text)).toEqual([
      { line: 2, col: 3 },
      { line: 2, col: 7 },
      { line: 3, col: 1 },
    ])
  })

  it('counts lines the same way with CRLF line endings', () => {
    expect(findEmDashes(`one\r\ntwo ${EM_DASH}\r\n`)).toEqual([{ line: 2, col: 5 }])
  })

  it('ignores hyphens and en dashes', () => {
    expect(findEmDashes(`a - b -- c ${EN_DASH} d`)).toEqual([])
  })

  it('uses U+2014', () => {
    expect(EM_DASH.codePointAt(0)).toBe(0x2014)
  })
})

describe('isChecked', () => {
  it.each(['README.md', 'SPEC.md', 'packages/core/src/index.ts', 'docs/adr/0001-stack.md'])(
    'checks %s',
    (path) => {
      expect(isChecked(path)).toBe(true)
    },
  )

  it.each([
    'pnpm-lock.yaml',
    'packages/config/__fixtures__/boundaries/apps/alpha/src/index.ts',
    'packages\\sources\\typescript\\__fixtures__\\handbook.md',
    '__fixtures__/x.md',
  ])('skips %s', (path) => {
    expect(isChecked(path)).toBe(false)
  })
})

describe('isBinary', () => {
  it('detects a NUL byte', () => {
    expect(isBinary(Uint8Array.from([0x89, 0x50, 0x00, 0x47]))).toBe(true)
  })

  it('treats UTF-8 text as text', () => {
    expect(isBinary(new TextEncoder().encode(`text ${EM_DASH} text`))).toBe(false)
  })
})
