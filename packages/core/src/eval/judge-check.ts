// Does the judge get the obvious cases right? (ADR-0012.) Before any full run it grades
// answers whose grade is known: the expert's own answer, an empty one, "I don't know", a
// confident answer to another question, a made-up fact, and citations that do and do not
// support their claim. A wrong grade here means no verdict from it can be trusted.
import type Anthropic from '@anthropic-ai/sdk'
import type { EvalClaim } from '@docs-rag-lab/contracts'

import { EvalStoppedError, requestKey, Runner, type RunnerOptions } from './answers.ts'
import type { GoldenQuestion } from './golden.ts'
import {
  correctnessRequest,
  isUnanswerable,
  parseCorrectness,
  parseRefusal,
  parseSupport,
  refusalRequest,
  supportRequest,
  type JudgeSettings,
} from './judge.ts'

export interface JudgeCase {
  name: string
  request: Anthropic.MessageCreateParamsNonStreaming
  /** What the grade must be, as text, so a failure can print both. */
  expected: string
  read: (message: Anthropic.Message) => string
}

export interface JudgeCaseResult {
  name: string
  expected: string
  got: string
  passed: boolean
}

const correctness =
  (claims: 'refusal' | 'answer') =>
  (message: Anthropic.Message): string => {
    const parsed = parseCorrectness(message)
    return claims === 'refusal'
      ? `score ${String(parsed.correctness)}, false refusal ${String(parsed.falseRefusal)}`
      : `score ${String(parsed.correctness)}`
  }

const outcome = (message: Anthropic.Message): string => parseRefusal(message).outcome

const supported =
  (count: number) =>
  (message: Anthropic.Message): string =>
    parseSupport(message, count)
      .map((claim) => (claim.supported ? 'supported' : 'unsupported'))
      .join(', ')

const SUPPORTED_CLAIM: EvalClaim = {
  text: 'The noImplicitAny option reports an error when a type is implicitly any.',
  citations: [
    {
      chunkId: 'case',
      citedText:
        'When noImplicitAny is enabled, TypeScript issues an error whenever it infers the type any.',
    },
  ],
}

const UNSUPPORTED_CLAIM: EvalClaim = {
  text: 'The noImplicitAny option was added in TypeScript 5.0.',
  citations: [
    {
      chunkId: 'case',
      citedText:
        'When noImplicitAny is enabled, TypeScript issues an error whenever it infers the type any.',
    },
  ],
}

/** The cases, built from the golden set so that they read like real ones. */
export function judgeCases(
  questions: readonly GoldenQuestion[],
  settings: JudgeSettings,
): JudgeCase[] {
  const answerable = questions.filter((question) => !isUnanswerable(question)).slice(0, 3)
  const unanswerable = questions.filter(isUnanswerable)
  const [first, second, other] = answerable
  if (first === undefined || second === undefined || other === undefined) {
    throw new Error('the judge check needs 3 questions that have answers')
  }
  const cases: JudgeCase[] = []
  for (const question of [first, second]) {
    const offTopic = question === first ? second : other
    const cases_: [string, string, string, JudgeCase['read']][] = [
      ["the expert's answer", question.answer, 'score 2', correctness('answer')],
      ['an empty answer', '', 'score 0', correctness('answer')],
      [
        '"I do not know"',
        'I do not know. The documentation does not cover this.',
        'score 0, false refusal true',
        correctness('refusal'),
      ],
      ['a confident answer to another question', offTopic.answer, 'score 0', correctness('answer')],
    ]
    for (const [name, answer, expected, read] of cases_) {
      cases.push({
        name: `${question.id}, ${name}`,
        request: correctnessRequest(settings, question, answer),
        expected,
        read,
      })
    }
  }
  for (const question of unanswerable) {
    cases.push(
      {
        name: `${question.id}, the expert's refusal`,
        request: refusalRequest(settings, question, question.answer, []),
        expected: 'correct-refusal',
        read: outcome,
      },
      {
        name: `${question.id}, a refusal in other words`,
        request: refusalRequest(
          settings,
          question,
          'The search results do not say anything about this, so I cannot answer it from them.',
          [],
        ),
        expected: 'correct-refusal',
        read: outcome,
      },
      {
        name: `${question.id}, a made-up fact from the docs`,
        request: refusalRequest(
          settings,
          question,
          'According to the documentation, this was added in TypeScript 5.4, and it is on by default.',
          [],
        ),
        expected: 'hallucination',
        read: outcome,
      },
    )
  }
  cases.push(
    {
      name: 'a claim its passage supports',
      request: supportRequest(settings, [SUPPORTED_CLAIM]),
      expected: 'supported',
      read: supported(1),
    },
    {
      name: 'a claim its passage does not support',
      request: supportRequest(settings, [UNSUPPORTED_CLAIM]),
      expected: 'unsupported',
      read: supported(1),
    },
  )
  return cases
}

/** Grades every case. Repeating the check costs nothing, since each call is cached. */
export async function runJudgeCheck(
  cases: readonly JudgeCase[],
  options: RunnerOptions,
): Promise<JudgeCaseResult[]> {
  const runner = new Runner(options)
  const results: JudgeCaseResult[] = []
  await runner.run(cases, async ({ name, request, expected, read }) => {
    try {
      const { call } = await runner.call(
        'judge-check',
        request,
        requestKey(request, 1),
        (message) => {
          read(message)
        },
      )
      const got = read(call.message)
      results.push({ name, expected, got, passed: got === expected })
    } catch (error) {
      if (error instanceof EvalStoppedError) return
      const got = error instanceof Error ? error.message : String(error)
      results.push({ name, expected, got, passed: false })
    }
  })
  runner.check()
  return results.sort((a, b) => a.name.localeCompare(b.name))
}
