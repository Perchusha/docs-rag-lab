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
})
