import type {
  AgreementResult,
  CalibrationDisagreement,
  EvalCalibration,
  EvalVerifyRecord,
} from '@docs-rag-lab/contracts'
import { describe, expect, it } from 'vitest'

import { judgeSentence, judgeTrust, verifyWords } from './trust.ts'

const PROMPTS = { correctness: 'c2', refusal: 'r1', support: 's1' }

const result = (
  dimension: AgreementResult['dimension'],
  agreed: number,
  compared: number,
  passed = true,
): AgreementResult => ({ dimension, compared, agreed, kappa: 1, interval: [0.5, 1], passed })

const disagreement = (human: 0 | 1 | 2, judge: 0 | 1 | 2): CalibrationDisagreement => ({
  questionId: 'ts-0001',
  row: 3,
  human,
  judge,
})

function round(overrides: Partial<EvalCalibration> = {}): EvalCalibration {
  return {
    report: { repoSha: 'x', name: 'answers', createdAt: 'then' },
    blind: true,
    prompts: PROMPTS,
    correctnessDisagreements: [],
    labelled: 15,
    agreement: [result('correctness', 12, 12), result('refusal', 15, 15), result('support', 8, 8)],
    unanswerableOnly: { compared: 3, agreed: 3 },
    calibrated: true,
    ...overrides,
  }
}

const judge = (rounds: EvalCalibration[]) => judgeTrust({ prompts: PROMPTS }, rounds)

describe('judgeTrust', () => {
  it('is calibrated when a blind round under these prompts passed every dimension', () => {
    const trust = judge([round()])

    expect(trust.calibrated).toBe(true)
    expect(trust.agreement.map(({ dimension }) => dimension)).toEqual([
      'correctness',
      'refusal',
      'support',
    ])
  })

  it('is not calibrated with no rounds', () => {
    expect(judge([])).toMatchObject({ calibrated: false, agreement: [], bias: null, note: null })
  })

  it('is not calibrated when a dimension failed', () => {
    expect(
      judge([
        round({
          agreement: [
            result('correctness', 10, 12, false),
            result('refusal', 15, 15),
            result('support', 8, 8),
          ],
        }),
      ]).calibrated,
    ).toBe(false)
  })

  it('shows a changed prompt as not calibrated, by itself', () => {
    const trust = judgeTrust({ prompts: { ...PROMPTS, correctness: 'changed' } }, [round()])

    expect(trust.calibrated).toBe(false)
    expect(trust.agreement.map(({ dimension }) => dimension)).toEqual(['refusal', 'support'])
  })

  it('lets the latest blind round under the prompt decide each dimension', () => {
    const first = round({
      prompts: { ...PROMPTS, correctness: 'c1' },
      agreement: [
        result('correctness', 10, 12, false),
        result('refusal', 15, 15),
        result('support', 8, 8),
      ],
    })
    const fresh = round({ agreement: [result('correctness', 9, 10)] })

    const trust = judge([first, fresh])

    expect(trust.calibrated).toBe(true)
    expect(trust.agreement.find(({ dimension }) => dimension === 'correctness')).toMatchObject({
      agreed: 9,
      compared: 10,
    })
  })

  it('lets the later of two blind rounds under one prompt decide', () => {
    const trust = judge([
      round({ agreement: [result('correctness', 10, 12, false)] }),
      round({ agreement: [result('correctness', 9, 10)] }),
    ])

    expect(trust.agreement[0]).toMatchObject({ agreed: 9, compared: 10, passed: true })
  })

  it('never lets labels that are not blind decide, whatever they say', () => {
    const trust = judge([
      round({
        agreement: [
          result('correctness', 10, 12, false),
          result('refusal', 15, 15),
          result('support', 8, 8),
        ],
      }),
      round({ blind: false, agreement: [result('correctness', 12, 12)] }),
    ])

    expect(trust.calibrated).toBe(false)
    expect(trust.agreement[0]).toMatchObject({ agreed: 10 })
  })

  it('counts the bias over all blind rounds, whatever their prompt', () => {
    const trust = judge([
      round({
        prompts: { ...PROMPTS, correctness: 'c1' },
        correctnessDisagreements: [disagreement(1, 2), disagreement(1, 2)],
      }),
      round({ correctnessDisagreements: [disagreement(1, 2)] }),
      round({ blind: false, correctnessDisagreements: [disagreement(1, 2)] }),
    ])

    expect(trust).toMatchObject({ judgeHigher: 3, judgeLower: 0, note: 'may run high' })
    expect(trust.bias).toBe(
      'All 3 disagreements are the judge scoring higher than the human: correctness may be slightly inflated.',
    )
  })

  it('says one disagreement in the singular', () => {
    expect(judge([round({ correctnessDisagreements: [disagreement(1, 2)] })]).bias).toContain(
      'The 1 disagreement is the judge scoring higher',
    )
  })

  it('says when the judge runs low instead', () => {
    expect(judge([round({ correctnessDisagreements: [disagreement(2, 1)] })])).toMatchObject({
      judgeHigher: 0,
      judgeLower: 1,
      note: 'may run low',
    })
  })

  it('claims no lean when the disagreements go both ways', () => {
    const trust = judge([
      round({ correctnessDisagreements: [disagreement(1, 2), disagreement(2, 1)] }),
    ])

    expect(trust.note).toBeNull()
    expect(trust.bias).toBe('The judge scored higher than the human on 1 answers and lower on 1.')
  })

  it('reads a calibration from before prompts and disagreements were recorded', () => {
    const old = round()
    delete old.prompts
    delete old.correctnessDisagreements

    expect(judge([old])).toMatchObject({ calibrated: false, judgeHigher: 0, bias: null })
  })

  it('names each round, and marks which were blind', () => {
    const trust = judge([
      round(),
      round({ agreement: [result('correctness', 9, 10)] }),
      round({ blind: false }),
    ])

    expect(trust.rounds.map(({ name, blind }) => [name, blind])).toEqual([
      ['First round', true],
      ['Fresh round', true],
      ['First round, graded again', false],
    ])
  })
})

describe('judgeSentence', () => {
  it('says calibrated, with the bias', () => {
    expect(judgeSentence(judge([round({ correctnessDisagreements: [disagreement(1, 2)] })]))).toBe(
      'The judge is calibrated for these prompts. The 1 disagreement is the judge scoring higher than the human: correctness may be slightly inflated.',
    )
  })

  it('says not calibrated', () => {
    expect(judgeSentence(judge([]))).toContain('not calibrated')
  })
})

describe('verifyWords', () => {
  const record = (overrides: Partial<EvalVerifyRecord> = {}): EvalVerifyRecord => ({
    status: 'identical',
    changedVectors: [],
    rerun: { repoSha: 'abcdef1234', repoDirty: false, at: 'then' },
    ...overrides,
  })

  it.each([
    [record(), 'byte for byte at abcdef12, on the same vectors'],
    [record({ changedVectors: ['query'] }), 'on other vectors'],
    [record({ status: 'equivalent' }), 'the same conclusions at abcdef12'],
    [record({ status: 'inconclusive' }), 'Inconclusive'],
    [record({ status: 'different' }), 'Did not reproduce'],
    [record({ status: 'not-comparable' }), 'Not checked'],
    [
      record({ rerun: { repoSha: 'abcdef1234', repoDirty: true, at: 'then' } }),
      'with uncommitted changes',
    ],
  ])('says what it found: %j', (value, words) => {
    expect(verifyWords(value, false)).toContain(words)
  })

  it('says answers are no part of the check, when there are answers', () => {
    expect(verifyWords(record(), true)).toContain('Answers do not repeat')
    expect(verifyWords(record(), false)).not.toContain('Answers')
  })
})
