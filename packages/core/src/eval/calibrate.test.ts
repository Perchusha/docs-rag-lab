import type {
  AnswerLabel,
  AnswerRow,
  EvalAnswer,
  EvalSupport,
  EvalVerdict,
} from '@docs-rag-lab/contracts'
import { describe, expect, it } from 'vitest'

import { calibrate, cohensKappa, sampleForLabels, wilsonInterval } from './calibrate.ts'
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

  it('never fills up with more unanswerable questions than the one per row', () => {
    const answers = [41, 42, 43, 44, 45, 1, 2, 3, 4, 5].map((i) => answer(i, 3))

    const picked = sampleForLabels({ rows: [3], answers, verdicts: [], questions })

    expect(picked).toHaveLength(5)
    expect(picked.filter((item) => item.questionId >= ID(41))).toHaveLength(1)
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
    const { agreement } = calibrate({
      report,
      labels: [
        label(1, 3, { correctness: 2, supported: true }),
        label(2, 3, { correctness: 0, supported: false }),
        label(41, 3, { outcome: 'wrong' }),
      ],
      verdicts: [verdict(1, 3, 2), verdict(2, 3, 1), verdict(41, 3, null, { outcome: 'wrong' })],
      support: [support(1, 3, true, true), support(2, 3, true, false)],
    })

    expect(
      agreement.map(({ dimension, compared, agreed }) => [dimension, compared, agreed]),
    ).toEqual([
      ['correctness', 2, 1],
      ['outcome', 1, 1],
      ['support', 2, 2],
    ])
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
        label(1, 3, { correctness: 2, supported: true }),
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
