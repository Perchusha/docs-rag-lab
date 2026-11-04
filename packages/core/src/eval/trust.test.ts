import type {
  AgreementResult,
  CalibrationDisagreement,
  EvalCalibration,
  EvalSpotCheck,
  EvalVerifyRecord,
} from '@docs-rag-lab/contracts'
import { describe, expect, it } from 'vitest'

import {
  judgeSentence,
  judgeTrust,
  spotCheckSentence,
  spotCheckView,
  verifyWords,
} from './trust.ts'

const PROMPTS = { correctness: 'c2', refusal: 'r1', support: 's1' }
const MODELS = { answer: 'a', judge: 'j' }

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
    judgeModel: 'j',
    correctnessDisagreements: [],
    labelled: 15,
    agreement: [result('correctness', 12, 12), result('refusal', 15, 15), result('support', 8, 8)],
    unanswerableOnly: { compared: 3, agreed: 3 },
    calibrated: true,
    ...overrides,
  }
}

const judge = (rounds: EvalCalibration[]) =>
  judgeTrust({ prompts: PROMPTS, models: MODELS }, rounds)

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
    const trust = judgeTrust({ prompts: { ...PROMPTS, correctness: 'changed' }, models: MODELS }, [
      round(),
    ])

    expect(trust.calibrated).toBe(false)
    expect(trust.agreement.map(({ dimension }) => dimension)).toEqual(['refusal', 'support'])
  })

  it('shows another judge as not calibrated, with no bias from labels of a different model', () => {
    const trust = judgeTrust({ prompts: PROMPTS, models: { answer: 'a', judge: 'other' } }, [
      round({ correctnessDisagreements: [disagreement(1, 2)] }),
    ])

    expect(trust).toMatchObject({ calibrated: false, agreement: [], judgeHigher: 0, bias: null })
  })

  it('is not calibrated when a calibration file could not be read, and says which', () => {
    const trust = judgeTrust({ prompts: PROMPTS, models: MODELS }, [round()], ['broken'])

    expect(trust).toMatchObject({ calibrated: false, unreadable: ['broken'] })
    expect(judgeSentence(trust)).toContain('Could not read broken.')
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
    delete old.judgeModel
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

  it('gives a later full round a name of its own, by its report', () => {
    const later = round({ report: { repoSha: 'y', name: 'm5-answers', createdAt: 'later' } })
    const trust = judge([round(), round({ blind: false }), later])

    expect(trust.rounds.map(({ name }) => name)).toEqual([
      'First round',
      'First round, graded again',
      'Later round, m5-answers',
    ])
  })

  it('names a later round by its commit when its report has no name', () => {
    const later = round({ report: { repoSha: 'abcdef1234567', name: null, createdAt: 'later' } })

    expect(judge([round(), later]).rounds.map(({ name }) => name)).toEqual([
      'First round',
      'Later round, abcdef12',
    ])
  })

  it('still calls a full round first when only a round that was not blind came before', () => {
    const trust = judge([round({ blind: false }), round()])

    expect(trust.rounds.map(({ name }) => name)).toEqual([
      'First round, graded again',
      'First round',
    ])
  })
})

describe('a spot check', () => {
  const spot = (overrides: Partial<EvalSpotCheck> = {}): EvalSpotCheck => ({
    report: { repoSha: 'x', name: 'final', createdAt: 'then' },
    prompts: PROMPTS,
    judgeModel: 'j',
    correctnessDisagreements: [],
    labelled: 10,
    agreement: [result('correctness', 8, 8), result('refusal', 10, 10), result('support', 5, 6)],
    unanswerableOnly: { compared: 2, agreed: 2 },
    allowed: 1,
    passed: true,
    ...overrides,
  })

  it('says what it found, in a sentence', () => {
    expect(spotCheckSentence(spot())).toBe(
      'A spot check of 10 of these answers, labelled blind, passed: correctness 8 of 8, refusal 10 of 10, support 5 of 6.',
    )
  })

  it('says when it missed, and which way a disagreement leans', () => {
    const found = spot({
      passed: false,
      correctnessDisagreements: [disagreement(1, 2), disagreement(0, 2)],
    })

    expect(spotCheckSentence(found)).toBe(
      'A spot check of 10 of these answers, labelled blind, missed: correctness 8 of 8, refusal 10 of 10, support 5 of 6. All 2 disagreements are the judge scoring higher than the human: correctness may be slightly inflated.',
    )
    expect(spotCheckView(found)).toMatchObject({ passed: false, allowed: 1, labelled: 10 })
  })

  it('has no lean with no disagreement', () => {
    expect(spotCheckView(spot()).bias).toBeNull()
  })
})

describe('rounds labelled on another source', () => {
  const onTypescript = (overrides: Partial<EvalCalibration> = {}): EvalCalibration =>
    round({ sourceId: 'typescript', ...overrides })
  const onReact = (rounds: EvalCalibration[]) =>
    judgeTrust({ prompts: PROMPTS, models: MODELS }, rounds, [], 'react')

  it('decide for a report under the same prompts and model, and say whose answers they were', () => {
    const trust = onReact([onTypescript()])

    expect(trust.calibrated).toBe(true)
    expect(trust.calibratedOn).toEqual(['typescript'])
    expect(trust.rounds.map(({ name }) => name)).toEqual(['First round, on typescript'])
    expect(judgeSentence(trust)).toBe(
      "The judge is calibrated for these prompts, on typescript's answers.",
    )
  })

  it('say that the lean they found is from there', () => {
    const trust = onReact([onTypescript({ correctnessDisagreements: [disagreement(1, 2)] })])

    expect(trust.note).toBe('may run high')
    expect(trust.bias).toBe(
      "The 1 disagreement is the judge scoring higher than the human: correctness may be slightly inflated. That is on typescript's answers.",
    )
  })

  it('still do not decide under other prompts', () => {
    const other = onTypescript({ prompts: { ...PROMPTS, correctness: 'another prompt' } })

    expect(onReact([other])).toMatchObject({ calibrated: false })
  })

  it('leave a report on the same source as it was', () => {
    const trust = judgeTrust(
      { prompts: PROMPTS, models: MODELS },
      [onTypescript({ correctnessDisagreements: [disagreement(1, 2)] })],
      [],
      'typescript',
    )

    expect(trust).toEqual(judge([round({ correctnessDisagreements: [disagreement(1, 2)] })]))
    expect(trust).not.toHaveProperty('calibratedOn')
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
