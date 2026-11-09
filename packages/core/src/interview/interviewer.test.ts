import type Anthropic from '@anthropic-ai/sdk'
import type { BankQuestion, RetrievalRequest } from '@docs-rag-lab/contracts'
import type { SearchHit, StoredMockTurn } from '@docs-rag-lab/db'
import type { InterviewerSettings, PricingSettings } from '@docs-rag-lab/settings'
import { describe, expect, it } from 'vitest'

import type { AnswerClient } from '../generate.ts'
import type { Retrieval } from '../retrieve.ts'
import {
  gradeAnswer,
  gradeRequest,
  INTERVIEWER_SYSTEM_PROMPT,
  mockQuestionOf,
  mockSummary,
  pickMockQuestions,
  type Interviewer,
} from './interviewer.ts'
import type { LoadedBank } from './progress.ts'

const question = (
  source: string,
  id: string,
  topicId: string,
  kind: BankQuestion['kind'] = 'theory',
): BankQuestion => ({
  id,
  source,
  kind,
  topicId,
  prompt: `Question ${id}?`,
  answer: `The bank's answer to ${id}.`,
  quote: `The docs say ${id}.`,
  citation: {
    url: `https://docs.dev/${topicId}#${id}`,
    title: topicId,
    sectionPath: ['Section'],
    docPath: `${topicId}.md`,
    chunkId: `chunk-${id}`,
  },
  verifiedBy: kind.startsWith('compiler') ? 'compiler' : 'checker',
})

// Core takes model IDs and prices as arguments, never from settings (ADR-0007).
const interviewerSettings: InterviewerSettings = {
  effort: 'low',
  maxTokens: 1000,
  questions: 5,
  passages: 6,
}
const pricing: PricingSettings = {
  checked: '2026-11-09',
  sources: [],
  models: { 'claude-test': { input: 2, output: 10 } },
}

const bank: LoadedBank = {
  topics: [
    { source: 'typescript', id: 'narrowing', title: 'Narrowing', group: 'Handbook' },
    { source: 'typescript', id: 'generics', title: 'Generics', group: 'Handbook' },
    { source: 'typescript', id: 'classes', title: 'Classes', group: 'Handbook' },
    { source: 'react', id: 'hooks', title: 'Hooks', group: 'Reference' },
    { source: 'react', id: 'state', title: 'State', group: 'Learn' },
  ],
  questions: [
    question('typescript', 't1', 'narrowing'),
    question('typescript', 't2', 'narrowing'),
    question('typescript', 't3', 'generics'),
    question('typescript', 't4', 'classes'),
    question('typescript', 'c1', 'classes', 'compiler-error'),
    question('react', 'r1', 'hooks', 'pitfall'),
    question('react', 'r2', 'state'),
    question('react', 'r3', 'state'),
  ],
}

describe('pickMockQuestions (ADR-0018)', () => {
  it('asks generated questions only, one per topic, a source in turn', () => {
    const picked = pickMockQuestions(bank, ['typescript', 'react'], 5, 'session-1')

    expect(picked.map(({ source }) => source)).toEqual([
      'typescript',
      'react',
      'typescript',
      'react',
      'typescript',
    ])
    expect(picked.some(({ kind }) => kind === 'compiler-error')).toBe(false)
    const topics = picked.map(({ source, topicId }) => `${source}:${topicId}`)
    expect(new Set(topics).size).toBe(topics.length)
  })

  it('is the same for one session, and gives fewer when the topics run out', () => {
    const ids = (seed: string) =>
      pickMockQuestions(bank, ['typescript', 'react'], 5, seed).map(({ id }) => id)

    expect(ids('session-1')).toEqual(ids('session-1'))
    expect(pickMockQuestions(bank, ['react'], 5, 'session-1')).toHaveLength(2)
    expect(pickMockQuestions(bank, ['react'], 1, 'session-1')).toHaveLength(1)
  })
})

describe('mockQuestionOf', () => {
  it('asks the question without the bank answer, its quote or its citation', () => {
    expect(mockQuestionOf(bank, question('react', 'r1', 'hooks', 'pitfall'))).toEqual({
      id: 'r1',
      source: 'react',
      kind: 'pitfall',
      topicTitle: 'Hooks',
      prompt: 'Question r1?',
    })
  })
})

const hit = (n: number): SearchHit => ({
  chunkId: `hit-${String(n)}`,
  text: `Passage ${String(n)} of the docs.`,
  context: null,
  headingPath: ['Section'],
  anchor: `section-${String(n)}`,
  blockTypes: ['prose'],
  metadata: {},
  tokenCount: 10,
  docPath: 'narrowing.md',
  url: 'https://docs.dev/narrowing',
  title: 'Narrowing',
  docType: 'handbook',
})

/** A fake interviewer: search returns three passages, and Claude replies with `reply`. */
function fakeInterviewer(
  reply: unknown,
  stopReason = 'end_turn',
): { interviewer: Interviewer; searches: RetrievalRequest[]; requests: unknown[] } {
  const searches: RetrievalRequest[] = []
  const requests: unknown[] = []
  const message = {
    stop_reason: stopReason,
    content: [{ type: 'text', text: JSON.stringify(reply), citations: null }],
    usage: { input_tokens: 3000, output_tokens: 300 },
  } as unknown as Anthropic.Message
  const client: AnswerClient = {
    messages: {
      stream(request) {
        requests.push(request)
        return {
          on: () => undefined,
          finalMessage: () => Promise.resolve(message),
          currentMessage: message,
        }
      },
    },
  }
  return {
    searches,
    requests,
    interviewer: {
      search: (request: RetrievalRequest): Promise<Retrieval> => {
        searches.push(request)
        return Promise.resolve({ hits: [hit(1), hit(2), hit(3)], trace: {} as Retrieval['trace'] })
      },
      client,
    },
  }
}

const options = (interviewer: Interviewer) => ({
  interviewer,
  model: 'claude-test',
  settings: interviewerSettings,
  pricing,
})

describe('gradeAnswer', () => {
  const asked = question('typescript', 't1', 'narrowing')

  it('searches for what was asked and answered, and grades against those passages', async () => {
    const fake = fakeInterviewer({
      score: 1,
      feedback: 'Right on typeof [1], missing truthiness [3].',
      citations: [3, 1, 9],
      follow_up: 'What does `in` narrow?',
    })
    const grade = await gradeAnswer(
      { question: asked, step: 'question', asked: asked.prompt, answer: 'typeof checks.' },
      options(fake.interviewer),
    )

    expect(fake.searches).toEqual([
      {
        source: 'typescript',
        question: 'Question t1?\n\ntypeof checks.',
        strategy: 'hybrid',
        topK: 6,
      },
    ])
    expect(grade).toMatchObject({
      score: 1,
      feedback: 'Right on typeof [1], missing truthiness [3].',
      followUp: 'What does `in` narrow?',
      citations: [
        { number: 1, url: 'https://docs.dev/narrowing#section-1', title: 'Narrowing > Section' },
        { number: 3, url: 'https://docs.dev/narrowing#section-3', title: 'Narrowing > Section' },
      ],
    })
    expect(grade.costUsd).toBeGreaterThan(0)
  })

  it('asks no follow-up after an answer to a follow-up', async () => {
    const fake = fakeInterviewer({
      score: 2,
      feedback: 'Right.',
      citations: [],
      follow_up: 'More?',
    })
    const grade = await gradeAnswer(
      {
        question: asked,
        step: 'follow-up',
        asked: 'What does in narrow?',
        answer: 'Unions by property.',
        firstAnswer: 'typeof checks.',
      },
      options(fake.interviewer),
    )

    expect(grade.followUp).toBeUndefined()
    expect(fake.searches[0]?.question).toBe('What does in narrow?\n\nUnions by property.')
  })

  it('checks an answer on a card with the same grade, and asks no follow-up', async () => {
    const fake = fakeInterviewer({
      score: 1,
      feedback: 'Верно про typeof [1].',
      citations: [1],
      follow_up: 'What does `in` narrow?',
    })
    const grade = await gradeAnswer(
      {
        question: asked,
        step: 'question',
        asked: asked.prompt,
        answer: 'Проверки typeof.',
        check: true,
      },
      options(fake.interviewer),
    )
    const request = fake.requests[0] as ReturnType<typeof gradeRequest>
    const content = request.messages[0]?.content
    const text = Array.isArray(content) && content[0]?.type === 'text' ? content[0].text : ''

    expect(grade).toMatchObject({
      score: 1,
      feedback: 'Верно про typeof [1].',
      followUp: undefined,
    })
    expect(text).toMatch(/Grade the answer to the question\. There is no follow-up\.$/)
    expect(fake.searches[0]?.question).toBe('Question t1?\n\nПроверки typeof.')
  })

  it('refuses a reply cut off, or a score that is not 0, 1 or 2', async () => {
    const input = { question: asked, step: 'question' as const, asked: 'Q?', answer: 'A.' }
    const ok = { score: 2, feedback: 'Right.', citations: [], follow_up: '' }

    await expect(
      gradeAnswer(input, options(fakeInterviewer(ok, 'max_tokens').interviewer)),
    ).rejects.toThrow('the grade stopped with max_tokens')
    await expect(
      gradeAnswer(input, options(fakeInterviewer({ ...ok, score: 3 }).interviewer)),
    ).rejects.toThrow('its score is not 0, 1 or 2')
  })
})

describe('gradeRequest', () => {
  it('gives the reference, the code, the numbered passages and the answer, as data', () => {
    const withCode: BankQuestion = {
      ...question('typescript', 't1', 'narrowing'),
      code: { lang: 'ts', code: 'let x = 1', setup: 'declare const y: string', compiled: true },
    }
    const request = gradeRequest(
      'claude-test',
      interviewerSettings,
      {
        question: withCode,
        step: 'follow-up',
        asked: 'And y?',
        answer: 'A string.',
        firstAnswer: 'A number.',
      },
      [{ number: 1, url: 'u', title: 'Narrowing > Section', text: 'Passage one.' }],
    )
    const content = request.messages[0]?.content
    const text = Array.isArray(content) && content[0]?.type === 'text' ? content[0].text : ''

    expect(request.system).toBe(INTERVIEWER_SYSTEM_PROMPT)
    expect(text).toContain(
      "<reference>The bank's answer to t1.\nIt rests on: The docs say t1.</reference>",
    )
    expect(text).toContain('<setup_code>\ndeclare const y: string\n</setup_code>')
    expect(text).toContain('<code lang="ts">\nlet x = 1\n</code>')
    expect(text).toContain('<first_answer>A number.</first_answer>\n<follow_up>And y?</follow_up>')
    expect(text).toContain(
      '<passage number="1" title="Narrowing > Section">\nPassage one.\n</passage>',
    )
    expect(text).toContain('<answer>A string.</answer>\nGrade the answer to the follow-up.')
    expect(INTERVIEWER_SYSTEM_PROMPT).toContain('they decide')
    expect(INTERVIEWER_SYSTEM_PROMPT).toContain('in the language of the answer')
  })

  it("marks a compiler question's reference as the compiler's, which decides", () => {
    const request = gradeRequest(
      'claude-test',
      interviewerSettings,
      {
        question: {
          ...question('typescript', 'c1', 'classes', 'compiler-error'),
          quote: undefined,
        },
        step: 'question',
        asked: 'Question c1?',
        answer: 'It errors.',
        check: true,
      },
      [],
    )
    const content = request.messages[0]?.content
    const text = Array.isArray(content) && content[0]?.type === 'text' ? content[0].text : ''

    expect(text).toContain('<reference from="compiler">The bank\'s answer to c1.</reference>')
    expect(INTERVIEWER_SYSTEM_PROMPT).toContain('it decides what the code does')
  })
})

describe('mockSummary', () => {
  const turn = (
    questionId: string,
    step: string,
    score: number,
    cited: { number: number; url: string; title: string }[] = [],
  ): StoredMockTurn => ({
    sessionId: 's1',
    questionId,
    step,
    prompt: step === 'question' ? `Question ${questionId}?` : 'And then?',
    answer: 'An answer.',
    score,
    feedback: 'Feedback.',
    citations: JSON.stringify(cited),
    followUp: null,
    costUsd: 0.01,
    answeredAt: '2026-11-09T10:00:00.000Z',
  })

  it('scores each question answered, and names the weak topics and three sections to read', () => {
    const summary = mockSummary(
      { id: 's1', questionIds: ['t1', 'r1', 't3', 'r2'], startedAt: '2026-11-09T09:00:00.000Z' },
      [
        turn('t1', 'question', 2),
        turn('t1', 'follow-up', 2),
        turn('r1', 'question', 1, [
          { number: 2, url: 'https://react.dev/hooks#rules', title: 'Rules' },
        ]),
        turn('r1', 'follow-up', 0),
        turn('t3', 'question', 0, [{ number: 1, url: 'https://docs.dev/generics#x', title: 'X' }]),
      ],
      bank,
    )

    expect(summary.questions.map(({ questionId, score, max }) => [questionId, score, max])).toEqual(
      [
        ['t1', 4, 4],
        ['r1', 1, 4],
        ['t3', 0, 2],
      ],
    )
    expect(summary).toMatchObject({ score: 5, max: 10 })
    expect(summary.costUsd).toBeCloseTo(0.05)
    expect(summary.weakTopics.map(({ title, score, max }) => [title, score, max])).toEqual([
      ['Generics', 0, 2],
      ['Hooks', 1, 4],
    ])
    expect(summary.read).toEqual([
      { url: 'https://docs.dev/generics#t3', title: 'generics > Section' },
      { url: 'https://docs.dev/hooks#r1', title: 'hooks > Section' },
      { url: 'https://docs.dev/generics#x', title: 'X' },
    ])
  })

  it('has nothing to read when every answer scored 2', () => {
    const summary = mockSummary(
      { id: 's1', questionIds: ['t1'], startedAt: '2026-11-09T09:00:00.000Z' },
      [turn('t1', 'question', 2)],
      bank,
    )

    expect(summary.weakTopics).toEqual([])
    expect(summary.read).toEqual([])
  })
})
