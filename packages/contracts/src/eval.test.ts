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

describe('a report with answers', () => {
  const answers = {
    models: {},
    prompts: {},
    rows: [],
    comparisons: [],
    answers: [],
    verdicts: [],
    support: [],
  }

  it('takes the outline of the answers', () => {
    expect(parseEvalReport({ ...outline, answers }).ok).toBe(true)
  })

  it.each([
    ['nothing in them', {}],
    ['no models', { ...answers, models: undefined }],
    ['no verdicts', { ...answers, verdicts: undefined }],
  ])('refuses answers with %s', (_name, value) => {
    expect(parseEvalReport({ ...outline, answers: value }).ok).toBe(false)
  })
})

describe('parseEvalCalibration', () => {
  const calibration = {
    report: { createdAt: 'then' },
    agreement: [{ dimension: 'correctness', agreed: 9, compared: 10, interval: [0.6, 0.98] }],
  }

  it('takes the outline of a calibration', () => {
    expect(parseEvalCalibration(calibration)).toEqual({ ok: true, value: calibration })
  })

  it.each([
    ['something that is not an object', 'text', 'a JSON object'],
    ['no report', { agreement: [] }, 'report'],
    ['a report with no date', { report: {}, agreement: [] }, 'createdAt'],
    ['no agreement', { report: { createdAt: 'then' } }, 'agreement'],
    [
      'an agreement with no interval',
      {
        report: { createdAt: 'then' },
        agreement: [{ dimension: 'support', agreed: 1, compared: 1 }],
      },
      'interval',
    ],
  ])('refuses %s', (_name, value, message) => {
    const parsed = parseEvalCalibration(value)

    expect(parsed.ok).toBe(false)
    expect(parsed.ok ? '' : parsed.error).toContain(message)
  })
})

describe('parseEvalVerifyRecord', () => {
  const record = { status: 'identical', changedVectors: [], rerun: { repoSha: 'abc', at: 'then' } }

  it('takes the outline of a verify record', () => {
    expect(parseEvalVerifyRecord(record)).toEqual({ ok: true, value: record })
  })

  it.each([
    ['something that is not an object', null, 'a JSON object'],
    ['no status', { ...record, status: undefined }, 'status'],
    ['a status this code does not know', { ...record, status: 'bogus' }, 'status'],
    ['no changed vectors', { ...record, changedVectors: undefined }, 'changedVectors'],
    ['no re-run', { ...record, rerun: undefined }, 'rerun'],
    ['a re-run with no SHA', { ...record, rerun: { at: 'then' } }, 'repoSha'],
  ])('refuses %s', (_name, value, message) => {
    const parsed = parseEvalVerifyRecord(value)

    expect(parsed.ok).toBe(false)
    expect(parsed.ok ? '' : parsed.error).toContain(message)
  })
})
