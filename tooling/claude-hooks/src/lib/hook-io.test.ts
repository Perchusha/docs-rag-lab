import { describe, expect, it } from 'vitest'

import { formatSeconds, parseHookInput, stringField, truncate } from './hook-io.ts'
import { stopOutcome } from './stop.ts'

describe('parseHookInput', () => {
  it('parses a hook payload', () => {
    const input = parseHookInput(
      JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: '/repo/x.ts' } }),
    )

    expect(stringField(input.tool_input, 'file_path')).toBe('/repo/x.ts')
  })

  it('treats empty input as an empty payload', () => {
    expect(parseHookInput('  ')).toEqual({})
  })

  it('rejects input that is not a JSON object', () => {
    expect(() => parseHookInput('[]')).toThrow(/not a JSON object/)
    expect(() => parseHookInput('{')).toThrow()
  })
})

describe('stringField', () => {
  it('ignores missing and non-string fields', () => {
    expect(stringField(undefined, 'file_path')).toBeUndefined()
    expect(stringField({ file_path: 42 }, 'file_path')).toBeUndefined()
  })
})

describe('truncate', () => {
  it('keeps short output unchanged', () => {
    expect(truncate('error TS2345', 100)).toBe('error TS2345')
  })

  it('keeps the start and the end of long output', () => {
    const text = `${'a'.repeat(50)}${'b'.repeat(100)}${'c'.repeat(50)}`
    const result = truncate(text, 100)

    expect(result.startsWith('a'.repeat(50))).toBe(true)
    expect(result.endsWith('c'.repeat(40))).toBe(true)
    expect(result).toContain('[100 characters truncated]')
  })
})

describe('formatSeconds', () => {
  it('formats milliseconds with one decimal', () => {
    expect(formatSeconds(4321)).toBe('4.3s')
  })
})

describe('stopOutcome', () => {
  it('lets Claude stop when tests pass', () => {
    expect(stopOutcome(true, false)).toBe('pass')
    expect(stopOutcome(true, true)).toBe('pass')
  })

  it('blocks the first stop when tests fail', () => {
    expect(stopOutcome(false, false)).toBe('block')
  })

  it('never blocks twice in a row, so the hook cannot loop', () => {
    expect(stopOutcome(false, true)).toBe('warn')
  })
})
