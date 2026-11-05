// Does the judge get the obvious cases right? (ADR-0012.) Before any full run it grades
// answers whose grade is known: the expert's own answer, an empty one, "I don't know", a
// confident answer to another question, a made-up fact, a status left out that a grading note
// asks for, and citations that do and do not support their claim. A wrong grade here means no
// verdict from it can be trusted.
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

/** Two parts to ask about, so that a case can leave out or get wrong just one. */
const TWO_PARTS: GoldenQuestion = {
  id: 'two-parts',
  question: 'What do the `alpha` and `beta` options default to?',
  answer: '`alpha` defaults to `true`, and `beta` defaults to `false`.',
  primary: [],
  primaryMatch: 'all',
  acceptable: [],
  tags: ['basic'],
  note: undefined,
}

const STATUS_LEFT_OUT =
  'No. It is not an MCP server and does not go in the MCP client config. It is a small browser library you import into the page you are debugging, and it runs inside that page. The only MCP server you configure is Chrome DevTools MCP, which discovers the React tools automatically when it connects to the page.'

/**
 * ADR-0016's status rule, in the words of react-0002. The question does not ask for the
 * status, and the prompt says that details the question did not ask for do not count, so the
 * grading note is what has to make leaving it out cost a point.
 */
const STATUS_RULE: GoldenQuestion = {
  id: 'status-rule',
  question: 'Do I have to add `react-devtools-cdt-mcp` as a server in my MCP client configuration?',
  answer: `${STATUS_LEFT_OUT} It is experimental.`,
  primary: [],
  primaryMatch: 'all',
  acceptable: [],
  tags: ['fresh'],
  note: 'The status rule of ADR-0016: this API is on the experimental channel, so the status is part of what a fully correct answer gives, and an answer that does not say it is experimental scores at most 1.',
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
  const twoParts: [string, string, string][] = [
    ['one part missing, however small', '`alpha` defaults to `true`.', 'score 1'],
    ['one part wrong', '`alpha` defaults to `true`, and `beta` to `true`.', 'score 1'],
    [
      'details the question did not ask for',
      '`alpha` defaults to `true`, and `beta` to `false`. The separate `gamma` option defaults to 3.',
      'score 2',
    ],
  ]
  for (const [name, answer, expected] of twoParts) {
    cases.push({
      name: `two parts, ${name}`,
      request: correctnessRequest(settings, TWO_PARTS, answer),
      expected,
      read: correctness('answer'),
    })
  }
  cases.push(
    {
      name: 'a status its grading note asks for, left out',
      request: correctnessRequest(settings, STATUS_RULE, STATUS_LEFT_OUT),
      expected: 'score 1',
      read: correctness('answer'),
    },
    {
      // Without this one, a judge that caps every answer with this note would pass the case above.
      name: 'a status its grading note asks for, given',
      request: correctnessRequest(settings, STATUS_RULE, STATUS_RULE.answer),
      expected: 'score 2',
      read: correctness('answer'),
    },
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
