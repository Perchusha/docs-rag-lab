import type {
  AnswerLabel,
  AnswerRow,
  EvalAnswer,
  EvalSupport,
  EvalVerdict,
} from '@docs-rag-lab/contracts'
import { describe, expect, it } from 'vitest'

import {
  calibrate,
  cohensKappa,
  FRESH_SEED,
  freshSampleForLabels,
  LABEL_SEED,
  sampleForLabels,
  sampleHash,
  wilsonInterval,
  type FreshSampleOptions,
} from './calibrate.ts'
import { parseGoldenSet } from './golden.ts'

const ID = (i: number): string => `ts-${String(i).padStart(4, '0')}`
const ROWS = [0, 2, 3] as const

const questions = parseGoldenSet(
  Array.from({ length: 45 }, (_, i) =>
    JSON.stringify(
      i < 40
        ? { id: ID(i + 1), question: 'Q?', answer: 'A.', primary: ['a.md'], tags: ['basic'] }
        : { id: ID(i + 1), question: 'Q?', answer: 'No.', tags: ['unanswerable'] },
    ),
  ).join('\n'),
)

const answer = (i: number, row: AnswerRow, overrides: Partial<EvalAnswer> = {}): EvalAnswer => ({
  questionId: ID(i),
  row,
  sample: 1,
  status: 'ok',
  model: 'm',
  stopReason: 'end_turn',
  text: 'T',
  blocks: [],
  claims: [],
  context: [],
  inputTokens: 1,
  outputTokens: 1,
  costUsd: 0,
  latencyMs: 1,
  firstTokenMs: 1,
  fromCache: false,
  ...overrides,
})

const verdict = (
  i: number,
  row: AnswerRow,
  correctness: 0 | 1 | 2 | null,
  overrides: Partial<EvalVerdict> = {},
): EvalVerdict => ({
  questionId: ID(i),
  row,
  sample: 1,
  judgeSample: 1,
  status: 'ok',
  reasoning: 'r',
  correctness,
  falseRefusal: false,
  outcome: null,
  costUsd: 0,
  ...overrides,
})

const allAnswers = ROWS.flatMap((row) => Array.from({ length: 45 }, (_, i) => answer(i + 1, row)))
// A few low scores per row, among many high ones.
const allVerdicts = ROWS.flatMap((row) =>
  Array.from({ length: 40 }, (_, i) => verdict(i + 1, row, i % 13 === 0 ? 0 : 2)),
)
const sample = () =>
  sampleForLabels({ rows: ROWS, answers: allAnswers, verdicts: allVerdicts, questions })

describe('sampleForLabels', () => {
  it('takes 15 answers, 5 per row', () => {
    const picked = sample()

    expect(picked).toHaveLength(15)
    for (const row of ROWS) {
      expect(picked.filter((item) => item.row === row)).toHaveLength(5)
    }
  })

  it('has at least 3 unanswerable questions and 3 the judge scored low', () => {
    const picked = sample()
    const low = new Set(
      allVerdicts
        .filter((item) => item.correctness === 0)
        .map((item) => `${item.questionId}/${String(item.row)}`),
    )

    expect(picked.filter((item) => item.questionId >= ID(41)).length).toBeGreaterThanOrEqual(3)
    expect(
      picked.filter((item) => low.has(`${item.questionId}/${String(item.row)}`)).length,
    ).toBeGreaterThanOrEqual(3)
  })

  it('is the same every time, whatever the order of the input', () => {
    const ids = (items: EvalAnswer[]) =>
      items.map((item) => `${item.questionId}/${String(item.row)}`)

    expect(ids(sample())).toEqual(ids(sample()))
    expect(
      ids(
        sampleForLabels({
          rows: ROWS,
          answers: [...allAnswers].reverse(),
          verdicts: allVerdicts,
          questions,
        }),
      ),
    ).toEqual(ids(sample()))
  })

  it('changes with the seed', () => {
    const ids = (items: EvalAnswer[]) => items.map((item) => item.questionId).join()

    expect(
      ids(
        sampleForLabels({
          rows: ROWS,
          answers: allAnswers,
          verdicts: allVerdicts,
          questions,
          seed: 1,
        }),
      ),
    ).not.toBe(ids(sample()))
  })

  it('does not group by row, so the order says nothing about where an answer came from', () => {
    const rows = sample().map((item) => item.row)

    expect(rows.slice(0, 5)).not.toEqual([rows[0], rows[0], rows[0], rows[0], rows[0]])
  })

  it('takes only finished answers, and only the first sample', () => {
    const answers = [
      ...Array.from({ length: 10 }, (_, i) => answer(i + 1, 3, { status: 'failed' })),
      answer(20, 3),
      answer(21, 3, { sample: 2 }),
    ]

    expect(
      sampleForLabels({ rows: [3], answers, verdicts: [], questions }).map(
        (item) => item.questionId,
      ),
    ).toEqual([ID(20)])
  })

  it('reaches 3 low scores from one row, when that row has them all', () => {
    const answers = [1, 2, 3, 4, 5, 6, 7, 8].flatMap((i) => [answer(i, 0), answer(i, 3)])
    const verdicts = [
      ...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => verdict(i, 0, i <= 3 ? 0 : 2)),
      ...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => verdict(i, 3, 2)),
    ]

    const picked = sampleForLabels({ rows: [0, 3], answers, verdicts, questions })

    expect(picked.filter((item) => item.row === 0 && item.questionId <= ID(3))).toHaveLength(3)
    expect(picked.filter((item) => item.row === 0)).toHaveLength(5)
  })

  it('takes no more low scores than it needs', () => {
    const answers = Array.from({ length: 20 }, (_, i) => answer(i + 1, 3))
    const verdicts = answers.map((_, i) => verdict(i + 1, 3, 0))

    const picked = sampleForLabels({ rows: [3], answers, verdicts, questions })

    expect(picked).toHaveLength(5)
  })

  it('never fills up with more unanswerable questions than the one per row', () => {
    const answers = [41, 42, 43, 44, 45, 1, 2, 3, 4, 5].map((i) => answer(i, 3))

    const picked = sampleForLabels({ rows: [3], answers, verdicts: [], questions })

    expect(picked).toHaveLength(5)
    expect(picked.filter((item) => item.questionId >= ID(41))).toHaveLength(1)
  })
})

describe('freshSampleForLabels', () => {
  const first = sample()
  const fresh = (overrides: Partial<FreshSampleOptions> = {}) =>
    freshSampleForLabels({
      rows: ROWS,
      answers: allAnswers,
      verdicts: allVerdicts,
      questions,
      exclude: first,
      ...overrides,
    })

  it('takes 10 answers: 3, 3 and 4 by row', () => {
    const picked = fresh()

    expect(picked).toHaveLength(10)
    expect(picked.filter(({ row }) => row === 0)).toHaveLength(3)
    expect(picked.filter(({ row }) => row === 2)).toHaveLength(3)
    expect(picked.filter(({ row }) => row === 3)).toHaveLength(4)
  })

  it('takes only questions the docs answer', () => {
    expect(fresh().every(({ questionId }) => questionId < ID(41))).toBe(true)
  })

  it('takes no question of the first round, under any row', () => {
    const used = new Set(first.map(({ questionId }) => questionId))

    expect(fresh().filter(({ questionId }) => used.has(questionId))).toEqual([])
  })

  it('takes no question twice', () => {
    const ids = fresh().map(({ questionId }) => questionId)

    expect(new Set(ids).size).toBe(ids.length)
  })

  it('takes at least 3 low scores when there are 3, and they may be in one row', () => {
    const verdicts = allVerdicts.map((item) =>
      item.row === 0 && ['ts-0011', 'ts-0012', 'ts-0013'].includes(item.questionId)
        ? { ...item, correctness: 1 as const }
        : { ...item, correctness: 2 as const },
    )

    const picked = fresh({ verdicts, exclude: [] })

    expect(
      picked.filter(
        ({ row, questionId }) =>
          row === 0 && ['ts-0011', 'ts-0012', 'ts-0013'].includes(questionId),
      ),
    ).toHaveLength(3)
  })

  it('stops at the low scores it needs, and fills up from the rest', () => {
    const verdicts = allVerdicts.map((item) => ({
      ...item,
      correctness: Number(item.questionId.slice(3)) % 4 === 0 ? (0 as const) : (2 as const),
    }))
    const lows = fresh({ verdicts, exclude: [] }).filter(
      ({ questionId }) => Number(questionId.slice(3)) % 4 === 0,
    )

    expect(lows.length).toBeGreaterThanOrEqual(3)
    expect(lows.length).toBeLessThan(10)
  })

  it('has a seed of its own, apart from the first round', () => {
    const ids = (items: EvalAnswer[]) => items.map(({ questionId }) => questionId).join()

    expect(ids(fresh())).toBe(ids(fresh({ seed: FRESH_SEED })))
    expect(ids(fresh())).not.toBe(ids(fresh({ seed: LABEL_SEED })))
  })

  it.each([
    ['a second sample', { sample: 2 }],
    ['a second opinion', { judgeSample: 2 }],
  ])('does not take a low score from %s', (_name, overrides) => {
    const high = allVerdicts.map((item) => ({ ...item, correctness: 2 as const }))
    const lows = [21, 22, 23, 24, 25, 26].flatMap((i) =>
      ROWS.map((row) => verdict(i, row, 0, overrides)),
    )
    const ids = (items: EvalAnswer[]) =>
      items.map(({ questionId, row }) => `${questionId}/${String(row)}`).sort()

    expect(ids(fresh({ verdicts: [...lows, ...high], exclude: [] }))).toEqual(
      ids(fresh({ verdicts: high, exclude: [] })),
    )
  })

  it('takes only finished answers, and only the first sample', () => {
    const answers = [
      ...Array.from({ length: 30 }, (_, i) => answer(i + 1, 3, { status: 'failed' })),
      answer(31, 3, { sample: 2 }),
      answer(32, 3),
    ]

    expect(fresh({ answers, rows: [3], exclude: [] }).map(({ questionId }) => questionId)).toEqual([
      ID(32),
    ])
  })

  it('is the same every time, and not in row order', () => {
    const ids = (items: EvalAnswer[]) =>
      items.map((item) => `${item.questionId}/${String(item.row)}`)
    const rows = fresh().map(({ row }) => row)

    expect(ids(fresh())).toEqual(ids(fresh()))
    expect(rows).not.toEqual([...rows].sort())
  })
})

describe('sampleHash', () => {
  it('names the set of answers, in any order', () => {
    const [a, b] = [answer(1, 0), answer(2, 3)]

    expect(sampleHash([a, b])).toBe(sampleHash([b, a]))
  })

  it('changes with the question and with the row', () => {
    expect(sampleHash([answer(1, 0)])).not.toBe(sampleHash([answer(2, 0)]))
    expect(sampleHash([answer(1, 0)])).not.toBe(sampleHash([answer(1, 3)]))
  })
})

describe('cohensKappa', () => {
  it('is 1 for perfect agreement across values', () => {
    expect(
      cohensKappa([
        [1, 1],
        [2, 2],
      ]),
    ).toBe(1)
  })

  it('is 0 when agreement is what chance predicts', () => {
    expect(
      cohensKappa([
        [true, true],
        [true, false],
        [false, true],
        [false, false],
      ]),
    ).toBeCloseTo(0)
  })

  it('matches a worked example', () => {
    // Agreement 0.7, chance 0.5 * 0.6 + 0.5 * 0.4 = 0.5.
    const pairs: [string, string][] = [
      ...Array<[string, string]>(4).fill(['a', 'a']),
      ...Array<[string, string]>(3).fill(['b', 'b']),
      ...Array<[string, string]>(2).fill(['a', 'b']),
      ['b', 'a'],
    ]
    // a: 6 of 10 on the left, 5 of 10 on the right. b: 4 and 5. Chance = 0.3 + 0.2.
    expect(cohensKappa(pairs)).toBeCloseTo(0.4)
  })

  it('is undefined when both sides used a single value', () => {
    expect(cohensKappa([[1, 1]])).toBeNull()
    expect(cohensKappa([])).toBeNull()
  })
})

describe('wilsonInterval', () => {
  it('gives the published interval for 14 of 15', () => {
    const [low, high] = wilsonInterval(14, 15)

    expect(low).toBeCloseTo(0.702, 2)
    expect(high).toBeCloseTo(0.988, 2)
  })

  it('stays inside 0 and 1, and is wide when there is nothing to go on', () => {
    expect(wilsonInterval(0, 5)[0]).toBe(0)
    expect(wilsonInterval(5, 5)[1]).toBeCloseTo(1)
    expect(wilsonInterval(0, 0)).toEqual([0, 1])
  })
})

describe('calibrate', () => {
  const report = { repoSha: 'sha', name: null, createdAt: 'now' }
  const label = (i: number, row: AnswerRow, overrides: Partial<AnswerLabel>): AnswerLabel => ({
    questionId: ID(i),
    row,
    correctness: null,
    refused: null,
    outcome: null,
    supported: null,
    ...overrides,
  })
  const support = (i: number, row: AnswerRow, ...values: boolean[]): EvalSupport => ({
    questionId: ID(i),
    row,
    sample: 1,
    status: 'ok',
    claims: values.map((supported) => ({ supported, reason: 'r' })),
    costUsd: 0,
  })

  it('compares each dimension where both sides have a value', () => {
    const { agreement, unanswerableOnly } = calibrate({
      report,
      labels: [
        label(1, 3, { correctness: 2, refused: false, supported: true }),
        label(2, 3, { correctness: 0, refused: false, supported: false }),
        label(41, 3, { outcome: 'wrong' }),
      ],
      verdicts: [verdict(1, 3, 2), verdict(2, 3, 1), verdict(41, 3, null, { outcome: 'wrong' })],
      support: [support(1, 3, true, true), support(2, 3, true, false)],
    })

    expect(
      agreement.map(({ dimension, compared, agreed }) => [dimension, compared, agreed]),
    ).toEqual([
      ['correctness', 2, 1],
      ['refusal', 3, 3],
      ['support', 2, 2],
    ])
    expect(unanswerableOnly).toEqual({ compared: 1, agreed: 1 })
  })

  describe('refusal agreement, over every answer', () => {
    const refusalOf = (labels: AnswerLabel[], verdicts: EvalVerdict[]) => {
      const result = calibrate({ report, labels, verdicts, support: [] })
      return result.agreement.find(({ dimension }) => dimension === 'refusal')
    }

    it('counts an answerable question both sides say was answered', () => {
      expect(
        refusalOf([label(1, 3, { correctness: 1, refused: false })], [verdict(1, 3, 2)]),
      ).toMatchObject({ compared: 1, agreed: 1 })
    })

    it('counts it as a disagreement when only the human says an answer refused', () => {
      expect(
        refusalOf([label(1, 3, { correctness: 0, refused: true })], [verdict(1, 3, 0)]),
      ).toMatchObject({ compared: 1, agreed: 0 })
    })

    it('counts it as a disagreement when only the judge says an answer refused', () => {
      expect(
        refusalOf(
          [label(1, 3, { correctness: 0, refused: false })],
          [verdict(1, 3, 0, { falseRefusal: true })],
        ),
      ).toMatchObject({ compared: 1, agreed: 0 })
    })

    it('agrees when both say an answerable question was refused', () => {
      expect(
        refusalOf(
          [label(1, 3, { correctness: 0, refused: true })],
          [verdict(1, 3, 0, { falseRefusal: true })],
        ),
      ).toMatchObject({ compared: 1, agreed: 1 })
    })

    it('needs both sides to call a refusal right on an unanswerable question', () => {
      expect(
        refusalOf(
          [label(41, 3, { outcome: 'correct-refusal' })],
          [verdict(41, 3, null, { outcome: 'hallucination', falseRefusal: null })],
        ),
      ).toMatchObject({ compared: 1, agreed: 0 })
    })

    it('does not tell hallucination from wrong, which the separate line does', () => {
      const result = calibrate({
        report,
        labels: [label(41, 3, { outcome: 'hallucination' })],
        verdicts: [verdict(41, 3, null, { outcome: 'wrong', falseRefusal: null })],
        support: [],
      })

      expect(result.agreement.find(({ dimension }) => dimension === 'refusal')).toMatchObject({
        compared: 1,
        agreed: 1,
      })
      expect(result.unanswerableOnly).toEqual({ compared: 1, agreed: 0 })
    })

    it('leaves out an answer the judge could not grade', () => {
      expect(
        refusalOf(
          [label(1, 3, { correctness: 0, refused: false })],
          [verdict(1, 3, null, { status: 'failed', falseRefusal: null })],
        ),
      ).toMatchObject({ compared: 0, agreed: 0 })
    })

    it('holds refusals to 13 of 15 like everything else', () => {
      const run = (wrong: number) => {
        const labels = Array.from({ length: 15 }, (_, i) =>
          label(i + 1, 3, { correctness: 2, refused: false }),
        )
        const verdicts = Array.from({ length: 15 }, (_, i) =>
          verdict(i + 1, 3, 2, { falseRefusal: i < wrong }),
        )
        return refusalOf(labels, verdicts)?.passed
      }

      expect(run(2)).toBe(true)
      expect(run(3)).toBe(false)
    })
  })

  it('compares only the dimensions asked for, and calibrates on those', () => {
    const result = calibrate({
      report,
      labels: Array.from({ length: 10 }, (_, i) => label(i + 1, 3, { correctness: 2 })),
      verdicts: Array.from({ length: 10 }, (_, i) => verdict(i + 1, 3, i === 0 ? 1 : 2)),
      support: [],
      dimensions: ['correctness'],
    })

    expect(result.agreement.map(({ dimension }) => dimension)).toEqual(['correctness'])
    expect(result.agreement[0]).toMatchObject({ compared: 10, agreed: 9, passed: true })
    expect(result.calibrated).toBe(true)
  })

  it('allows 1 disagreement in 10, and not 2', () => {
    const run = (wrong: number) =>
      calibrate({
        report,
        labels: Array.from({ length: 10 }, (_, i) => label(i + 1, 3, { correctness: 2 })),
        verdicts: Array.from({ length: 10 }, (_, i) => verdict(i + 1, 3, i < wrong ? 1 : 2)),
        support: [],
        dimensions: ['correctness'],
      }).calibrated

    expect(run(1)).toBe(true)
    expect(run(2)).toBe(false)
  })

  it('never calls the judge calibrated on labels that are not blind', () => {
    const result = calibrate({
      report,
      labels: [label(1, 3, { correctness: 2 })],
      verdicts: [verdict(1, 3, 2)],
      support: [],
      dimensions: ['correctness'],
      blind: false,
    })

    expect(result).toMatchObject({ blind: false, calibrated: false })
    expect(result.agreement[0]?.passed).toBe(true)
  })

  it('does not let the unanswerable line decide anything', () => {
    const answerable = Array.from({ length: 13 }, (_, i) => i + 1)
    const result = calibrate({
      report,
      labels: [
        ...answerable.map((i) => label(i, 3, { correctness: 2, refused: false, supported: true })),
        label(41, 3, { outcome: 'hallucination' }),
        label(42, 3, { outcome: 'hallucination' }),
      ],
      verdicts: [
        ...answerable.map((i) => verdict(i, 3, 2)),
        verdict(41, 3, null, { outcome: 'wrong', falseRefusal: null }),
        verdict(42, 3, null, { outcome: 'wrong', falseRefusal: null }),
      ],
      support: answerable.map((i) => support(i, 3, true)),
    })

    expect(result.unanswerableOnly).toEqual({ compared: 2, agreed: 0 })
    expect(result.calibrated).toBe(true)
  })

  it('calls an answer supported only when the judge found every claim supported', () => {
    const { agreement } = calibrate({
      report,
      labels: [label(1, 3, { supported: true })],
      verdicts: [],
      support: [support(1, 3, true, false)],
    })

    expect(agreement.find(({ dimension }) => dimension === 'support')?.agreed).toBe(0)
  })

  it('passes at 13 of 15, and not below', () => {
    const run = (wrong: number) =>
      calibrate({
        report,
        labels: Array.from({ length: 15 }, (_, i) => label(i + 1, 3, { correctness: 2 })),
        verdicts: Array.from({ length: 15 }, (_, i) => verdict(i + 1, 3, i < wrong ? 0 : 2)),
        support: [],
      }).agreement[0]?.passed

    expect(run(2)).toBe(true)
    expect(run(3)).toBe(false)
  })

  it('is calibrated only when every dimension passed, and one with nothing compared did not', () => {
    const passing = {
      report,
      labels: [
        label(1, 3, { correctness: 2, refused: false, supported: true }),
        label(41, 3, { outcome: 'wrong' }),
      ],
      verdicts: [verdict(1, 3, 2), verdict(41, 3, null, { outcome: 'wrong' })],
      support: [support(1, 3, true)],
    }

    expect(calibrate(passing).calibrated).toBe(true)
    expect(calibrate({ ...passing, support: [] }).calibrated).toBe(false)
  })

  it('reads the first sample and the first opinion, of the right row', () => {
    const { agreement } = calibrate({
      report,
      labels: [label(1, 3, { correctness: 2 })],
      verdicts: [
        verdict(1, 2, 0),
        verdict(1, 3, 0, { sample: 2 }),
        verdict(1, 3, 0, { judgeSample: 2 }),
        verdict(1, 3, 2),
      ],
      support: [],
    })

    expect(agreement[0]).toMatchObject({ compared: 1, agreed: 1 })
  })
})
