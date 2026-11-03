import { describe, expect, it } from 'vitest'

import { EVAL_REPORT_VERSION, parseEvalReport } from './eval.ts'

const outline = {
  version: EVAL_REPORT_VERSION,
  identity: { docs: {}, goldenSet: {} },
  vectors: {},
  result: { strategies: [], targets: [] },
  run: { repoSha: 'abc' },
}

describe('parseEvalReport', () => {
  it('takes a report with the current version and the expected outline', () => {
    expect(parseEvalReport(outline)).toEqual({ ok: true, value: outline })
  })

  it('names the version of a report it cannot read', () => {
    expect(parseEvalReport({ ...outline, version: 99 })).toEqual({
      ok: false,
      error: `this report has version 99, and this code reads version ${String(EVAL_REPORT_VERSION)}`,
    })
  })

  it.each([
    ['something that is not an object', [], 'a JSON object'],
    ['no identity', { ...outline, identity: undefined }, 'identity'],
    ['identity without a golden set', { ...outline, identity: { docs: {} } }, 'goldenSet'],
    ['no vectors', { ...outline, vectors: undefined }, 'vectors'],
    ['no strategies', { ...outline, result: { targets: [] } }, 'strategies'],
    ['no targets', { ...outline, result: { strategies: [] } }, 'targets'],
    ['no run', { ...outline, run: undefined }, 'run'],
    ['a run with no SHA', { ...outline, run: {} }, 'repoSha'],
  ])('refuses %s', (_name, value, message) => {
    const parsed = parseEvalReport(value)

    expect(parsed.ok).toBe(false)
    expect(parsed.ok ? '' : parsed.error).toContain(message)
  })
})
