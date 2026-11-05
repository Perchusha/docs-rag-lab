import type Anthropic from '@anthropic-ai/sdk'
import { openEvalCache, type EvalCache } from '@docs-rag-lab/db'
import { afterEach, describe, expect, it } from 'vitest'

import { UsageMeter } from '../usage.ts'
import type { EvalClient } from './answers.ts'
import { parseGoldenSet } from './golden.ts'
import { judgeCases, runJudgeCheck } from './judge-check.ts'

const MODEL = 'claude-judge'
const settings = { model: MODEL, effort: 'medium', maxTokens: 100 } as const

const questions = parseGoldenSet(
  [
    { id: 'ts-0001', question: 'First?', answer: 'A1.', primary: ['a.md'], tags: ['basic'] },
    { id: 'ts-0002', question: 'Second?', answer: 'A2.', primary: ['a.md'], tags: ['basic'] },
    { id: 'ts-0003', question: 'Third?', answer: 'A3.', primary: ['a.md'], tags: ['basic'] },
    { id: 'ts-0041', question: 'Not covered?', answer: 'No.', tags: ['unanswerable'] },
    { id: 'ts-0042', question: 'Not there?', answer: 'No 2.', tags: ['unanswerable'] },
  ]
    .map((row) => JSON.stringify(row))
    .join('\n'),
)

/** A judge that always gives these replies, whatever the case. */
function judgeSaying(body: (request: Anthropic.MessageCreateParamsNonStreaming) => unknown) {
  const client: EvalClient = {
    messages: {
      stream(request) {
        const message = {
          model: MODEL,
          content: [{ type: 'text', text: JSON.stringify(body(request)), citations: null }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 1, output_tokens: 1 },
        } as unknown as Anthropic.Message
        return {
          on: () => undefined,
          finalMessage: () => Promise.resolve(message),
          currentMessage: message,
        }
      },
      countTokens: () => Promise.resolve({ input_tokens: 1 }),
    },
  }
  return client
}

/** What a judge that works would say, read from the request. */
function perfect(request: Anthropic.MessageCreateParamsNonStreaming): unknown {
  const text = (request.messages[0]?.content as { text: string }[])[0]?.text ?? ''
  const system = JSON.stringify(request.system)
  if (system.includes('You check the citations')) {
    return { claims: [{ claim: 1, reason: 'r', supported: !text.includes('TypeScript 5.0') }] }
  }
  if (system.includes('does not answer the question below')) {
    return { reasoning: 'r', outcome: text.includes('5.4') ? 'hallucination' : 'correct_refusal' }
  }
  if (text.includes('`alpha`')) {
    const score = text.includes('gamma') ? 2 : 1
    return { reasoning: 'r', correctness: score, false_refusal: false }
  }
  const answer = /<answer>(.*)<\/answer>/s.exec(text)?.[1] ?? ''
  const expert = /<expert_answer>(.*)<\/expert_answer>/s.exec(text)?.[1] ?? ''
  if (text.includes('<grading_note>')) {
    return { reasoning: 'r', correctness: answer === expert ? 2 : 1, false_refusal: false }
  }
  if (answer.includes('I do not know')) {
    return { reasoning: 'r', correctness: 0, false_refusal: true }
  }
  return { reasoning: 'r', correctness: answer === expert ? 2 : 0, false_refusal: false }
}

let cache: EvalCache | undefined

afterEach(() => {
  cache?.close()
  cache = undefined
})

const run = (client: EvalClient) => {
  cache ??= openEvalCache(':memory:')
  return runJudgeCheck(judgeCases(questions, settings), {
    client,
    cache,
    pricing: { checked: 'x', sources: [], models: { [MODEL]: { input: 1, output: 1 } } },
    meter: new UsageMeter(),
    maxUsd: 100,
    concurrency: 2,
    now: () => 0,
  })
}

describe('judgeCases', () => {
  it('covers each known failure, on two answerable questions and two unanswerable', () => {
    const names = judgeCases(questions, settings).map(({ name }) => name)

    expect(names.filter((name) => name.startsWith('ts-0001'))).toHaveLength(4)
    expect(names.filter((name) => name.startsWith('ts-0002'))).toHaveLength(4)
    expect(names.filter((name) => name.startsWith('ts-0041'))).toHaveLength(3)
    expect(names.filter((name) => name.startsWith('ts-0042'))).toHaveLength(3)
    expect(names).toContain('a claim its passage supports')
    expect(names).toContain('a claim its passage does not support')
    expect(names).toContain('two parts, one part missing, however small')
    expect(names).toContain('two parts, one part wrong')
    expect(names).toContain('two parts, details the question did not ask for')
    expect(names).toContain('a status its grading note asks for, left out')
    expect(names).toContain('a status its grading note asks for, given')
    expect(names).toHaveLength(21)
  })

  it('gives the status cases a grading note, and answers that differ only by the status', () => {
    const statusCase = (name: string) => {
      const found = judgeCases(questions, settings).find((judgeCase) => judgeCase.name === name)
      const text = (found?.request.messages[0]?.content as { text: string }[])[0]?.text ?? ''
      return {
        expected: found?.expected,
        text,
        expert: /<expert_answer>(.*)<\/expert_answer>/s.exec(text)?.[1],
        answer: /<answer>(.*)<\/answer>/s.exec(text)?.[1],
      }
    }
    const leftOut = statusCase('a status its grading note asks for, left out')
    const given = statusCase('a status its grading note asks for, given')

    expect(leftOut.text).toContain('<grading_note>The status rule of ADR-0016:')
    expect(leftOut.expert).toBe(`${leftOut.answer ?? ''} It is experimental.`)
    expect(leftOut.answer).not.toContain('experimental')
    expect(leftOut.expected).toBe('score 1')
    expect(given.text).toContain('<grading_note>The status rule of ADR-0016:')
    expect(given.answer).toBe(given.expert)
    expect(given.expected).toBe('score 2')
  })

  it('gives each question the expert answer of another as the confident wrong one', () => {
    const offTopic = judgeCases(questions, settings).find(
      ({ name }) => name === 'ts-0001, a confident answer to another question',
    )

    expect(JSON.stringify(offTopic?.request.messages)).toContain('<answer>A2.</answer>')
  })

  it('needs 3 questions with answers', () => {
    expect(() => judgeCases(questions.slice(0, 2), settings)).toThrow('3 questions')
  })
})

describe('runJudgeCheck', () => {
  it('passes a judge that gets every known case right', async () => {
    const results = await run(judgeSaying(perfect))

    expect(results.filter((result) => !result.passed)).toEqual([])
    expect(results).toHaveLength(21)
  })

  it('catches a judge that gives everything full marks', async () => {
    const results = await run(
      judgeSaying((request) =>
        JSON.stringify(request.system).includes('You check the citations')
          ? { claims: [{ claim: 1, reason: 'r', supported: true }] }
          : JSON.stringify(request.system).includes('does not answer the question below')
            ? { reasoning: 'r', outcome: 'correct_refusal' }
            : { reasoning: 'r', correctness: 2, false_refusal: false },
      ),
    )
    const wrong = results.filter((result) => !result.passed).map(({ name }) => name)

    expect(wrong).toContain('ts-0001, an empty answer')
    expect(wrong).toContain('ts-0001, a confident answer to another question')
    expect(wrong).toContain('ts-0041, a made-up fact from the docs')
    expect(wrong).toContain('a claim its passage does not support')
    expect(wrong).toContain('two parts, one part missing, however small')
    expect(wrong).toContain('two parts, one part wrong')
    expect(wrong).toContain('a status its grading note asks for, left out')
    expect(wrong).not.toContain('a status its grading note asks for, given')
    expect(wrong).not.toContain('two parts, details the question did not ask for')
    expect(wrong).not.toContain("ts-0001, the expert's answer")
  })

  it('catches a judge that takes a point whenever a grading note is there', async () => {
    const results = await run(
      judgeSaying((request) => {
        const text = JSON.stringify(request.messages)
        return text.includes('<grading_note>')
          ? { reasoning: 'r', correctness: 1, false_refusal: false }
          : perfect(request)
      }),
    )
    const wrong = results.filter((result) => !result.passed).map(({ name }) => name)

    expect(wrong).toEqual(['a status its grading note asks for, given'])
  })

  it('stops on output it cannot read, and does not cache it', async () => {
    await expect(run(judgeSaying(() => ({ nothing: true })))).rejects.toThrow('5 failures in a row')

    expect(cache?.stats('judge-check').calls).toBe(0)
  })

  it('keeps its calls apart from the ones the estimate learns from', async () => {
    await run(judgeSaying(perfect))

    expect(cache?.stats('judge').calls).toBe(0)
    expect(cache?.stats('judge-check').calls).toBe(21)
  })
})
