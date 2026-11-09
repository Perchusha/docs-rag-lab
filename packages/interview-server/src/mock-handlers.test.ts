import type { BankQuestion, MockGrade, MockSession, MockSummary } from '@docs-rag-lab/contracts'
import {
  openInterviewState,
  type AnswerClient,
  type Interviewer,
  type LoadedBank,
  type SearchHit,
} from '@docs-rag-lab/core'
import { settings } from '@docs-rag-lab/settings'
import { describe, expect, it } from 'vitest'

import type { InterviewBackend } from './handlers.ts'
import { handleMockAnswer, handleMockStart, handleMockSummary } from './mock-handlers.ts'

const NOW = new Date('2026-11-09T12:00:00.000Z')

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
    url: `https://docs.dev/${topicId}`,
    title: topicId,
    sectionPath: [],
    docPath: `${topicId}.md`,
    chunkId: `c-${id}`,
  },
  verifiedBy: kind.startsWith('compiler') ? 'compiler' : 'checker',
})

const bank: LoadedBank = {
  topics: [
    { source: 'typescript', id: 'narrowing', title: 'Narrowing', group: 'Handbook' },
    { source: 'react', id: 'hooks', title: 'Hooks', group: 'Reference' },
  ],
  questions: [
    question('typescript', 't1', 'narrowing'),
    question('typescript', 'c1', 'narrowing', 'compiler-type'),
    question('react', 'r1', 'hooks', 'pitfall'),
  ],
}

const hit: SearchHit = {
  chunkId: 'h1',
  text: 'A passage.',
  context: null,
  headingPath: [],
  anchor: 'a',
  blockTypes: ['prose'],
  metadata: {},
  tokenCount: 5,
  docPath: 'narrowing.md',
  url: 'https://docs.dev/narrowing',
  title: 'Narrowing',
  docType: 'handbook',
}

type Message = Awaited<ReturnType<ReturnType<AnswerClient['messages']['stream']>['finalMessage']>>

/** Retrieval with one passage, and a Claude that gives the next of `replies` to each grade. */
function fakeInterviewer(replies: unknown[]): { interviewer: Interviewer; calls: () => number } {
  let calls = 0
  const client: AnswerClient = {
    messages: {
      stream() {
        const reply = replies[calls++]
        const message = {
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: JSON.stringify(reply), citations: null }],
          usage: { input_tokens: 3000, output_tokens: 300 },
        } as unknown as Message
        return {
          on: () => undefined,
          finalMessage: () => Promise.resolve(message),
          currentMessage: message,
        }
      },
    },
  }
  return {
    calls: () => calls,
    interviewer: {
      search: () =>
        Promise.resolve({
          hits: [hit],
          trace: {} as Awaited<ReturnType<Interviewer['search']>>['trace'],
        }),
      client,
    },
  }
}

function backend(interviewer: Interviewer): InterviewBackend {
  const state = openInterviewState(':memory:')
  return {
    sources: ['typescript', 'react'],
    bank: () => bank,
    state: () => state,
    interviewer: () => interviewer,
    now: () => NOW,
    newId: () => 'session-1',
  }
}

const post = (body: unknown) =>
  new Request('http://127.0.0.1:3002/api/interview/mock', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

describe('the mock interview routes (ADR-0018)', () => {
  it('asks generated questions without their answers, grades each step once, and sums up', async () => {
    const fake = fakeInterviewer([
      { score: 1, feedback: 'Partly [1].', citations: [1], follow_up: 'And the rest?' },
      { score: 2, feedback: 'Right [1].', citations: [1], follow_up: '' },
    ])
    const one = backend(fake.interviewer)
    const started = await handleMockStart(() => one, post({ sources: ['react', 'typescript'] }))
    const session = (await started.json()) as MockSession

    expect(started.status).toBe(200)
    expect(session.id).toBe('session-1')
    expect(session.questions.map(({ id }) => id).sort()).toEqual(['r1', 't1'])
    expect(JSON.stringify(session)).not.toContain("The bank's answer")

    const first = await handleMockAnswer(
      () => one,
      post({ sessionId: 'session-1', questionId: 't1', step: 'question', answer: 'typeof.' }),
    )
    const grade = (await first.json()) as MockGrade
    expect(grade).toMatchObject({
      score: 1,
      feedback: 'Partly [1].',
      citations: [{ number: 1, url: 'https://docs.dev/narrowing#a', title: 'Narrowing' }],
      followUp: 'And the rest?',
      reference: { answer: "The bank's answer to t1." },
      skipped: false,
    })

    const again = await handleMockAnswer(
      () => one,
      post({ sessionId: 'session-1', questionId: 't1', step: 'question', answer: 'Again.' }),
    )
    expect(again.status).toBe(409)
    const followUp = (await (
      await handleMockAnswer(
        () => one,
        post({ sessionId: 'session-1', questionId: 't1', step: 'follow-up', answer: 'in, too.' }),
      )
    ).json()) as MockGrade
    expect(followUp).toMatchObject({ score: 2, step: 'follow-up', skipped: false })
    expect(followUp.reference).toBeUndefined()

    // A skipped answer is scored 0 with no call.
    const skipped = (await (
      await handleMockAnswer(
        () => one,
        post({ sessionId: 'session-1', questionId: 'r1', step: 'question', answer: '  ' }),
      )
    ).json()) as MockGrade
    expect(skipped).toMatchObject({ score: 0, skipped: true })
    expect(skipped.followUp).toBeUndefined()
    expect(fake.calls()).toBe(2)

    const summary = (await handleMockSummary(
      () => one,
      new Request('http://127.0.0.1:3002/api/interview/mock/summary?session=session-1'),
    ).json()) as MockSummary
    expect(summary).toMatchObject({ score: 3, max: 6 })
    expect(summary.weakTopics.map(({ title }) => title)).toEqual(['Hooks', 'Narrowing'])
    expect(summary.costUsd).toBeGreaterThan(0)
    expect(settings.interviewer.questions).toBeGreaterThanOrEqual(2)
  })

  it('refuses a follow-up before its question, and what the interview does not have', async () => {
    const one = backend(fakeInterviewer([]).interviewer)
    await handleMockStart(() => one, post({ sources: ['typescript'] }))
    const answer = (body: Record<string, string>) =>
      handleMockAnswer(
        () => one,
        post({ sessionId: 'session-1', questionId: 't1', step: 'question', answer: 'A.', ...body }),
      )

    expect((await answer({ step: 'follow-up' })).status).toBe(409)
    expect((await answer({ questionId: 'r1' })).status).toBe(404)
    expect((await answer({ sessionId: 'nope' })).status).toBe(404)
    expect((await answer({ step: 'third' })).status).toBe(400)
    expect((await handleMockStart(() => one, post({ sources: ['rust'] }))).status).toBe(400)
    expect((await handleMockStart(() => one, post('not json'))).status).toBe(400)
    const summary = handleMockSummary(
      () => one,
      new Request('http://127.0.0.1:3002/api/interview/mock/summary'),
    )
    expect(summary.status).toBe(400)
  })

  it('says so when the chosen technologies have no generated question', async () => {
    const one = backend(fakeInterviewer([]).interviewer)
    const onlyCompiler: LoadedBank = {
      ...bank,
      questions: [question('typescript', 'c1', 'narrowing', 'compiler-type')],
    }
    const none = await handleMockStart(
      () => ({ ...one, bank: () => onlyCompiler }),
      post({ sources: ['typescript'] }),
    )

    expect(none.status).toBe(404)
    expect(await none.json()).toEqual({
      error: 'the bank has no generated questions for these technologies yet',
    })
  })

  it('never asks a card the owner flagged as wrong', async () => {
    const one = backend(fakeInterviewer([]).interviewer)
    one.state().saveFlag({ questionId: 'r1', reason: 'Wrong.', flaggedAt: NOW.toISOString() })
    const session = (await (
      await handleMockStart(() => one, post({ sources: ['typescript', 'react'] }))
    ).json()) as MockSession

    expect(session.questions.map(({ id }) => id)).toEqual(['t1'])
  })

  const answerTo = (one: InterviewBackend, body: Record<string, string>) =>
    handleMockAnswer(
      () => one,
      post({ sessionId: 'session-1', questionId: 't1', step: 'question', answer: 'A.', ...body }),
    )

  it('has no follow-up after a skipped answer, or after a grade that asked none', async () => {
    const one = backend(
      fakeInterviewer([{ score: 2, feedback: 'Right.', citations: [], follow_up: '' }]).interviewer,
    )
    await handleMockStart(() => one, post({ sources: ['typescript', 'react'] }))

    await answerTo(one, { answer: '' })
    expect((await answerTo(one, { step: 'follow-up' })).status).toBe(409)
    await answerTo(one, { questionId: 'r1' })
    const none = await answerTo(one, { questionId: 'r1', step: 'follow-up' })
    expect(none.status).toBe(409)
    expect(await none.json()).toEqual({ error: 'this question has no follow-up to answer' })
  })

  it('refuses a grade it cannot use with a 502, saves nothing, and takes the answer again', async () => {
    const fake = fakeInterviewer([
      { score: 5, feedback: 'Off the scale.', citations: [], follow_up: '' },
      { score: 1, feedback: 'Partly.', citations: [], follow_up: 'More?' },
    ])
    const one = backend(fake.interviewer)
    await handleMockStart(() => one, post({ sources: ['typescript'] }))

    const refused = await answerTo(one, {})
    expect(refused.status).toBe(502)
    expect(await refused.json()).toEqual({
      error: 'the grade is missing a field, or its score is not 0, 1 or 2',
    })
    expect(one.state().mockTurns('session-1')).toEqual([])
    expect((await answerTo(one, {})).status).toBe(200)
    expect(fake.calls()).toBe(2)
  })

  it('keeps the first of two answers to one step, and gives the second a 409', async () => {
    const other: { backend?: InterviewBackend } = {}
    const fake = fakeInterviewer([{ score: 1, feedback: 'Partly.', citations: [], follow_up: '' }])
    // While this answer is graded, another tab's answer to the same step is saved.
    const racing: Interviewer = {
      ...fake.interviewer,
      search: (request, meter) => {
        other.backend?.state().saveMockTurn({
          sessionId: 'session-1',
          questionId: 't1',
          step: 'question',
          prompt: 'Question t1?',
          answer: 'From the other tab.',
          score: 2,
          feedback: 'Right.',
          citations: '[]',
          followUp: null,
          costUsd: 0.01,
          answeredAt: NOW.toISOString(),
        })
        return fake.interviewer.search(request, meter)
      },
    }
    const one = backend(racing)
    other.backend = one
    await handleMockStart(() => one, post({ sources: ['typescript'] }))

    const second = await answerTo(one, {})
    expect(second.status).toBe(409)
    expect(
      one
        .state()
        .mockTurns('session-1')
        .map(({ answer }) => answer),
    ).toEqual(['From the other tab.'])
  })

  it('says how long an answer may be', async () => {
    const one = backend(fakeInterviewer([]).interviewer)
    const long = await answerTo(one, { answer: 'x'.repeat(4_001) })

    expect(long.status).toBe(400)
    expect(((await long.json()) as { error: string }).error).toContain('at most 4000 characters')
  })
})
