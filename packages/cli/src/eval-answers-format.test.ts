import type {
  AnswerMetrics,
  AnswerRowResult,
  EvalAnswer,
  EvalAnswers,
} from '@docs-rag-lab/contracts'
import type { GoldenQuestion } from '@docs-rag-lab/core'
import { describe, expect, it } from 'vitest'

import {
  answerSections,
  formatAnswersSummary,
  formatCalibration,
  formatCostEstimate,
  formatJudgeCheck,
  formatLabelSheet,
} from './eval-answers-format.ts'

const metrics = (overrides: Partial<AnswerMetrics> = {}): AnswerMetrics => ({
  questions: 40,
  correctness: 1.5,
  scores: [3, 14, 23],
  falseRefusals: 2,
  citationAccuracy: { cited: 30, hit: 25 },
  support: { claims: 90, supported: 80 },
  meanLatencyMs: 2500,
  meanInputTokens: 6000,
  meanOutputTokens: 400,
  meanCostUsd: 0.0123,
  ...overrides,
})

const row = (overrides: Partial<AnswerRowResult> = {}): AnswerRowResult => ({
  row: 3,
  sample: 1,
  overall: metrics(),
  byTag: { basic: metrics({ questions: 15, correctness: 1.25 }) },
  refusals: { questions: 5, correct: 3, hallucinations: 1, wrong: 1 },
  excluded: { truncated: [], refused: [], failed: [], unjudged: [] },
  ...overrides,
})

const answers = (overrides: Partial<EvalAnswers> = {}): EvalAnswers => ({
  models: { answer: 'answer-model', judge: 'judge-model' },
  prompts: {},
  rows: [row()],
  comparisons: [],
  judgeRetest: null,
  candidates: [],
  paidUsd: 1.5,
  answers: [],
  verdicts: [],
  support: [],
  ...overrides,
})

const lineWith = (text: string, needle: string): string =>
  text.split('\n').find((line) => line.includes(needle)) ?? ''

describe('answerSections', () => {
  const comparison = answers({
    comparisons: [
      {
        a: 'row 2',
        b: 'row 3',
        scopes: [
          {
            scope: 'overall',
            questions: 40,
            differences: [
              {
                metric: 'correctness',
                a: 1.1,
                b: 1.9,
                aBetter: 2,
                bBetter: 11,
                tied: 27,
                p: 0.022,
                verdict: 'b',
              },
              {
                metric: 'citation-accuracy',
                a: 0.5,
                b: 0.75,
                aBetter: 1,
                bBetter: 3,
                tied: 16,
                p: 0.625,
                verdict: 'noise',
              },
            ],
          },
        ],
      },
    ],
  })
  const text = answerSections(comparison).join('\n\n')

  it('keeps each number on its own side, and names the winner', () => {
    expect(text).toContain(
      '| Scope | Questions | Metric | row 2 | row 3 | row 2 better on | row 3 better on | Tied | p | Verdict |',
    )
    expect(lineWith(text, '| correctness |')).toBe(
      '| overall | 40 | correctness | 1.100 | 1.900 | 2 | 11 | 27 | 0.022 | row 3 better |',
    )
  })

  it('counts the questions a citation metric compared, not the whole scope', () => {
    expect(lineWith(text, '| citation-accuracy |')).toBe(
      '| overall | 20 | citation-accuracy | 0.500 | 0.750 | 1 | 3 | 16 | 0.625 | noise |',
    )
  })

  it('names the side that won when it is the first', () => {
    const [scope] = comparison.comparisons[0]?.scopes ?? []
    const [difference] = scope?.differences ?? []
    if (scope === undefined || difference === undefined) throw new Error('no fixture')
    const flipped = answers({
      comparisons: [
        {
          a: 'row 0',
          b: 'row 3',
          scopes: [{ ...scope, differences: [{ ...difference, verdict: 'a' }] }],
        },
      ],
    })

    expect(lineWith(answerSections(flipped).join('\n'), '| correctness |')).toContain(
      '| row 0 better |',
    )
  })

  it('shows a row with each count in its column', () => {
    const body = answerSections(answers()).join('\n\n')

    expect(lineWith(body, '| row 3 | 40 |')).toBe(
      '| row 3 | 40 | 1.500 | 3 / 14 / 23 | 2 | 25 of 30 | 80 of 90 |',
    )
    expect(lineWith(body, '| row 3 | 5 |')).toBe('| row 3 | 5 | 3 | 1 | 1 |')
    expect(lineWith(body, '2.5 s')).toBe('| row 3 | 2.5 s | 6,000 | 400 | $0.0123 |')
    expect(lineWith(body, '| basic |')).toContain('| basic | row 3 | 15 | 1.250 |')
  })

  it('marks a second sample, and a row with no citations', () => {
    const body = answerSections(
      answers({
        rows: [
          row({
            row: 0,
            overall: metrics({
              citationAccuracy: { cited: 0, hit: 0 },
              support: { claims: 0, supported: 0 },
            }),
          }),
          row({ sample: 2 }),
        ],
      }),
    ).join('\n\n')

    expect(lineWith(body, '| row 0 | 40 |')).toContain('| - | - |')
    expect(body).toContain('| row 3 again | 40 |')
  })

  it('names the questions it left out, and why', () => {
    const body = answerSections(
      answers({
        rows: [
          row({
            excluded: {
              truncated: ['ts-0001'],
              refused: ['ts-0002'],
              failed: ['ts-0003'],
              unjudged: ['ts-0004'],
            },
          }),
        ],
      }),
    ).join('\n\n')

    expect(body).toContain(
      'Left out of row 3, not judged: ts-0004; truncated: ts-0001; stopped by a classifier: ts-0002; failed: ts-0003.',
    )
  })

  it('says nothing about leaving out when nothing was', () => {
    expect(answerSections(answers()).join('\n')).not.toContain('Left out')
  })

  it('reports the second opinion of the judge when there is one', () => {
    expect(
      answerSections(answers({ judgeRetest: { compared: 40, agreed: 37 } })).join('\n'),
    ).toContain('gave the same grade on 37 of 40')
  })

  it('lists chunks to review, and says none is added', () => {
    const body = answerSections(
      answers({
        candidates: [{ questionId: 'ts-0001', row: 3, chunkId: 'c1', docPath: 'a.md' }],
      }),
    ).join('\n')

    expect(lineWith(body, '| ts-0001 |')).toBe('| ts-0001 | 3 | c1 | a.md |')
    expect(body).toContain('None is added automatically')
  })

  it('says the judge is not calibrated until a human has labelled a sample', () => {
    expect(answerSections(answers()).join('\n')).toContain('The judge is not calibrated')
  })

  it('escapes a pipe, which would break the table', () => {
    const body = answerSections(
      answers({
        candidates: [{ questionId: 'ts-0001', row: 3, chunkId: 'c|1', docPath: 'a.md' }],
      }),
    ).join('\n')

    expect(body).toContain('c\\|1')
  })
})

describe('formatAnswersSummary', () => {
  it('prints what was paid and each row', () => {
    expect(formatAnswersSummary(answers())).toBe(
      [
        'paid $1.5000 at list prices',
        'row 3: correctness 1.500 over 40, 2 false refusals; unanswerable: 3 refused, 1 hallucinated, 1 wrong',
      ].join('\n'),
    )
  })
})

describe('formatCostEstimate', () => {
  const line = { calls: 10, cached: 4, inputTokens: 1500, outputTokens: 200, usd: 0.5 }
  const estimate = {
    answers: line,
    judge: { ...line, calls: 8, cached: 3, usd: 0.25 },
    usd: 0.75,
    assumed: false,
    pricesChecked: '2026-11-03',
  }

  it('shows each kind of call, what is cached, the total and the limit', () => {
    const text = formatCostEstimate(estimate, 15)

    expect(text).toContain('estimate, at list prices checked 2026-11-03:')
    expect(text).toContain(
      'answers: 10 (4 cached), 1,500 in by count_tokens, about 200 out, $0.5000',
    )
    expect(text).toContain('judge: 8 calls (3 cached), about 1,500 in and 200 out, $0.2500')
    expect(text).toContain('total: about $0.7500, against a limit of $15.00')
    expect(text).not.toContain('assumptions')
  })

  it('says when the output sizes are assumptions', () => {
    expect(formatCostEstimate({ ...estimate, assumed: true }, 15)).toContain(
      'output sizes are assumptions',
    )
  })
})

describe('formatLabelSheet', () => {
  const question = {
    id: 'ts-0001',
    question: 'First?',
    answer: 'Expert.',
    primary: [],
    primaryMatch: 'all',
    acceptable: [],
    tags: ['basic'],
    note: 'Watch for this.',
  } as GoldenQuestion
  const refused = {
    ...question,
    id: 'ts-0041',
    question: 'Not covered?',
    tags: ['unanswerable'],
    note: undefined,
  } as GoldenQuestion
  const answer = (overrides: Partial<EvalAnswer> = {}): EvalAnswer => ({
    questionId: 'ts-0001',
    row: 3,
    sample: 1,
    status: 'ok',
    model: 'm',
    stopReason: 'end_turn',
    text: 'The answer.',
    blocks: [],
    claims: [],
    context: [],
    inputTokens: 1,
    outputTokens: 1,
    costUsd: 1,
    latencyMs: 1,
    firstTokenMs: 1,
    fromCache: false,
    ...overrides,
  })
  const questions = new Map([
    [question.id, question],
    [refused.id, refused],
  ])

  it('shows what a human needs, and asks for the label a question needs', () => {
    const text = formatLabelSheet(
      [
        answer({
          claims: [{ text: 'Cited.', citations: [{ chunkId: 'c1', citedText: 'A passage.' }] }],
        }),
        answer({ questionId: 'ts-0041', text: '' }),
      ],
      questions,
      'abc123',
    )

    expect(text).toContain('Sample `abc123`')
    expect(text).toContain('## Item 1')
    expect(text).toContain('**Question:** First?')
    expect(text).toContain('**Expert answer:** Expert.')
    expect(text).toContain('**Note:** Watch for this.')
    expect(text).toContain('The answer.')
    expect(text).toContain('Claim 1: Cited.')
    expect(text).toContain('> A passage.')
    const [first = '', second = ''] = text.split('## Item 2')
    expect(first).toContain('**Label:** correctness 0, 1 or 2?')
    expect(first).not.toContain('correct-refusal, hallucination or wrong?')
    expect(first).toContain('Is every cited claim supported')
    expect(second).toContain('(empty)')
    expect(second).toContain('**Cites nothing.**')
    expect(second).toContain('correct-refusal, hallucination or wrong?')
    expect(second).not.toContain('correctness 0, 1 or 2?')
    expect(second).not.toContain('Is every cited claim supported')
  })

  it('leaves out the row, the chunk and the judge', () => {
    const text = formatLabelSheet(
      [
        answer({
          row: 2,
          claims: [{ text: 'C.', citations: [{ chunkId: 'chunk-id', citedText: 'P.' }] }],
        }),
      ],
      questions,
      'abc123',
    )

    expect(text).not.toMatch(/\brow\b/i)
    expect(text).not.toContain('chunk-id')
    expect(text).not.toContain('ts-0001')
  })
})

describe('formatCalibration', () => {
  it('shows each dimension, and whether the judge passed', () => {
    const text = formatCalibration({
      report: { repoSha: 'abcdef1234', name: 'answers', createdAt: 'now' },
      labelled: 15,
      agreement: [
        {
          dimension: 'correctness',
          compared: 12,
          agreed: 11,
          kappa: 0.8,
          interval: [0.65, 0.98],
          passed: true,
        },
        {
          dimension: 'outcome',
          compared: 3,
          agreed: 2,
          kappa: null,
          interval: [0.2, 0.94],
          passed: false,
        },
      ],
      calibrated: false,
    })

    expect(text).toContain('`abcdef12`, answers, now')
    expect(lineWith(text, '| correctness |')).toBe(
      '| correctness | 11 | 12 | 0.80 | 65% to 98% | yes |',
    )
    expect(lineWith(text, '| outcome |')).toBe('| outcome | 2 | 3 | - | 20% to 94% | no |')
    expect(text).toContain('uncalibrated')
  })
})

describe('formatJudgeCheck', () => {
  it('marks each case, and says what was expected where it went wrong', () => {
    const text = formatJudgeCheck([
      { name: 'one', expected: 'score 2', got: 'score 2', passed: true },
      { name: 'two', expected: 'score 0', got: 'score 2', passed: false },
    ])

    expect(text).toContain('ok     one: score 2')
    expect(text).toContain('WRONG  two: score 2, expected score 0')
    expect(text).toContain('got 1 of 2 known cases wrong')
  })
})
