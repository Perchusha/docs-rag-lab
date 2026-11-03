import { describe, expect, it } from 'vitest'

import {
  EVAL_REPORT_VERSION,
  parseEvalCalibration,
  parseEvalReport,
  parseEvalVerifyRecord,
} from './eval.ts'

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

describe('parseEvalCalibration', () => {
  const calibration = { report: { createdAt: 'then' }, agreement: [] }

  it('takes the outline of a calibration', () => {
    expect(parseEvalCalibration(calibration)).toEqual({ ok: true, value: calibration })
  })

  it.each([
    ['something that is not an object', 'text', 'a JSON object'],
    ['no report', { agreement: [] }, 'report'],
    ['a report with no date', { report: {}, agreement: [] }, 'createdAt'],
    ['no agreement', { report: { createdAt: 'then' } }, 'agreement'],
  ])('refuses %s', (_name, value, message) => {
    const parsed = parseEvalCalibration(value)

    expect(parsed.ok).toBe(false)
    expect(parsed.ok ? '' : parsed.error).toContain(message)
  })
})

describe('parseEvalVerifyRecord', () => {
  const record = { status: 'identical', rerun: { repoSha: 'abc' } }

  it('takes the outline of a verify record', () => {
    expect(parseEvalVerifyRecord(record)).toEqual({ ok: true, value: record })
  })

  it.each([
    ['something that is not an object', null, 'a JSON object'],
    ['no status', { rerun: { repoSha: 'abc' } }, 'status'],
    ['no re-run', { status: 'identical' }, 'rerun'],
    ['a re-run with no SHA', { status: 'identical', rerun: {} }, 'repoSha'],
  ])('refuses %s', (_name, value, message) => {
    const parsed = parseEvalVerifyRecord(value)

    expect(parsed.ok).toBe(false)
    expect(parsed.ok ? '' : parsed.error).toContain(message)
  })
})
