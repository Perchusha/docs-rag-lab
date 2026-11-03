import type Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it } from 'vitest'

import { parseGoldenSet, type GoldenQuestion } from './golden.ts'
import {
  correctnessRequest,
  JudgeOutputError,
  parseCorrectness,
  parseRefusal,
  parseSupport,
  refusalRequest,
  supportRequest,
} from './judge.ts'

const settings = { model: 'claude-judge', effort: 'medium', maxTokens: 100 } as const

const [question, noted] = parseGoldenSet(
  [
    { id: 'ts-0001', question: 'First?', answer: 'Expert.', primary: ['a.md'], tags: ['basic'] },
    {
      id: 'ts-0002',
      question: 'Second?',
      answer: 'Expert 2.',
      primary: ['a.md'],
      tags: ['edge'],
      note: 'Watch for this.',
    },
  ]
    .map((row) => JSON.stringify(row))
    .join('\n'),
) as [GoldenQuestion, GoldenQuestion]

const textOf = (request: Anthropic.MessageCreateParamsNonStreaming): string =>
  (request.messages[0]?.content as { text: string }[])[0]?.text ?? ''

const reply = (
  body: unknown,
  stopReason: Anthropic.Message['stop_reason'] = 'end_turn',
): Anthropic.Message =>
  ({
    content: [
      { type: 'thinking', thinking: 'hm', signature: 's' },
      {
        type: 'text',
        text: typeof body === 'string' ? body : JSON.stringify(body),
        citations: null,
      },
    ],
    stop_reason: stopReason,
  }) as unknown as Anthropic.Message

describe('the requests', () => {
  it('asks for structured output from the judge model, at the set effort', () => {
    const request = correctnessRequest(settings, question, 'An answer.')

    expect(request.model).toBe('claude-judge')
    expect(request.max_tokens).toBe(100)
    expect(request.output_config?.effort).toBe('medium')
    expect(request.output_config?.format?.type).toBe('json_schema')
  })

  it('shows the question, the expert answer and the answer, in tags', () => {
    expect(textOf(correctnessRequest(settings, question, 'An answer.'))).toBe(
      '<question>First?</question>\n<expert_answer>Expert.</expert_answer>\n<answer>An answer.</answer>',
    )
  })

  it('adds the grading note when the question has one', () => {
    expect(textOf(correctnessRequest(settings, noted, 'x'))).toContain(
      '<grading_note>Watch for this.</grading_note>',
    )
  })

  it('shows a refusal its citations, since it must not cite anything as support', () => {
    const cited = textOf(
      refusalRequest(settings, question, 'x', [
        { text: 'Claim.', citations: [{ chunkId: 'c', citedText: 'Passage.' }] },
      ]),
    )

    expect(cited).toContain('<claim>Claim.</claim><passage>Passage.</passage>')
    expect(textOf(refusalRequest(settings, question, 'x', []))).toContain(
      '<citations>none</citations>',
    )
  })

  it('numbers the claims of a support check, with all the passages of each', () => {
    const text = textOf(
      supportRequest(settings, [
        {
          text: 'One.',
          citations: [
            { chunkId: 'c', citedText: 'P1.' },
            { chunkId: 'c', citedText: 'P2.' },
          ],
        },
        { text: 'Two.', citations: [{ chunkId: 'd', citedText: 'P3.' }] },
      ]),
    )

    expect(text).toBe(
      [
        '<claim number="1">',
        '<text>One.</text>',
        '<passage>P1.</passage>',
        '<passage>P2.</passage>',
        '</claim>',
        '<claim number="2">',
        '<text>Two.</text>',
        '<passage>P3.</passage>',
        '</claim>',
      ].join('\n'),
    )
  })
})

describe('parseCorrectness', () => {
  it('reads a score, past any thinking block', () => {
    expect(
      parseCorrectness(reply({ reasoning: 'r', correctness: 1, false_refusal: false })),
    ).toEqual({ reasoning: 'r', correctness: 1, falseRefusal: false })
  })

  it.each([
    ['not JSON', reply('nope')],
    ['an array', reply([1])],
    ['a score out of range', reply({ reasoning: 'r', correctness: 3, false_refusal: false })],
    ['no reasoning', reply({ correctness: 1, false_refusal: false })],
    ['a false refusal that scored', reply({ reasoning: 'r', correctness: 2, false_refusal: true })],
    [
      'output cut off',
      reply({ reasoning: 'r', correctness: 1, false_refusal: false }, 'max_tokens'),
    ],
    ['a refused grade', reply({ reasoning: 'r', correctness: 1, false_refusal: false }, 'refusal')],
  ])('refuses %s', (_name, message) => {
    expect(() => parseCorrectness(message)).toThrow(JudgeOutputError)
  })
})

describe('parseRefusal', () => {
  it.each([
    ['correct_refusal', 'correct-refusal'],
    ['hallucination', 'hallucination'],
    ['wrong', 'wrong'],
  ])('reads %s', (outcome, expected) => {
    expect(parseRefusal(reply({ reasoning: 'r', outcome })).outcome).toBe(expected)
  })

  it('refuses an outcome it does not know', () => {
    expect(() => parseRefusal(reply({ reasoning: 'r', outcome: 'maybe' }))).toThrow(
      JudgeOutputError,
    )
  })
})

describe('parseSupport', () => {
  const entry = (claim: number, supported = true) => ({ claim, reason: 'r', supported })

  it('reads one entry per claim, in order', () => {
    expect(parseSupport(reply({ claims: [entry(1), entry(2, false)] }), 2)).toEqual([
      { supported: true, reason: 'r' },
      { supported: false, reason: 'r' },
    ])
  })

  it.each([
    ['too few', [entry(1)]],
    ['too many', [entry(1), entry(2), entry(3)]],
    ['out of order', [entry(2), entry(1)]],
    ['no verdict', [{ claim: 1, reason: 'r' }, entry(2)]],
  ])('refuses %s', (_name, claims) => {
    expect(() => parseSupport(reply({ claims }), 2)).toThrow(JudgeOutputError)
  })
})
