// The mock interview's routes (ADR-0018), as plain functions from a Request to a Response. Starting
// one and its summary call no model. Each answer that is not skipped costs one hybrid search and
// one call to Claude, about a cent at list prices.
import {
  parseMockAnswerRequest,
  parseMockStartRequest,
  type MockGrade,
  type MockSession,
  type MockSummary,
} from '@docs-rag-lab/contracts'
import {
  gradeAnswer,
  mockQuestionOf,
  mockSummary,
  pickMockQuestions,
  type GradeResult,
} from '@docs-rag-lab/core'
import { settings } from '@docs-rag-lab/settings'

import {
  chosenSources,
  fail,
  failure,
  NO_STORE,
  visibleBank,
  type BackendFactory,
} from './handlers.ts'

async function bodyOf(request: Request): Promise<{ ok: true; body: unknown } | { ok: false }> {
  try {
    return { ok: true, body: await request.json() }
  } catch {
    return { ok: false }
  }
}

/** POST /api/interview/mock: a new mock interview over the chosen technologies. */
export async function handleMockStart(
  factory: BackendFactory,
  request: Request,
): Promise<Response> {
  const read = await bodyOf(request)
  if (!read.ok) return fail(400, 'the body must be JSON')
  const start = parseMockStartRequest(read.body)
  if (start === undefined) return fail(400, 'a mock interview is { sources }, with one or more')
  try {
    const backend = factory()
    const sources = chosenSources(start.sources, backend)
    if (sources instanceof Response) return sources
    const bank = visibleBank(backend)
    const id = backend.newId()
    const questions = pickMockQuestions(bank, sources, settings.interviewer.questions, id)
    if (questions.length === 0) {
      return fail(404, 'the bank has no generated questions for these technologies yet')
    }
    backend.state().saveMockSession({
      id,
      questionIds: questions.map((question) => question.id),
      startedAt: backend.now().toISOString(),
    })
    const session: MockSession = {
      id,
      questions: questions.map((question) => mockQuestionOf(bank, question)),
    }
    return Response.json(session, { headers: NO_STORE })
  } catch (error) {
    return failure(error)
  }
}

const SKIPPED: GradeResult = {
  score: 0,
  feedback: 'Skipped: nothing to grade.',
  citations: [],
  followUp: undefined,
  costUsd: 0,
}

/**
 * POST /api/interview/mock/answer: one answer graded, to a question or to its follow-up. Each
 * step is answered once. An empty answer skips the step, with no call.
 */
export async function handleMockAnswer(
  factory: BackendFactory,
  request: Request,
): Promise<Response> {
  const read = await bodyOf(request)
  if (!read.ok) return fail(400, 'the body must be JSON')
  const answer = parseMockAnswerRequest(read.body)
  if (answer === undefined) {
    return fail(
      400,
      'an answer is { sessionId, questionId, step, answer }, with step question or follow-up',
    )
  }
  try {
    const backend = factory()
    const state = backend.state()
    const session = state.mockSession(answer.sessionId)
    if (session === undefined) return fail(404, `there is no mock interview ${answer.sessionId}`)
    const question = backend.bank().questions.find(({ id }) => id === answer.questionId)
    if (!session.questionIds.includes(answer.questionId) || question === undefined) {
      return fail(404, `this interview has no question ${answer.questionId}`)
    }
    const turns = state.mockTurns(session.id).filter((turn) => turn.questionId === question.id)
    if (turns.some((turn) => turn.step === answer.step)) {
      return fail(409, 'this step is answered already')
    }
    const first = turns.find((turn) => turn.step === 'question')
    if (answer.step === 'follow-up' && (first === undefined || first.followUp === null)) {
      return fail(409, 'this question has no follow-up to answer')
    }
    const asked = answer.step === 'question' ? question.prompt : (first?.followUp ?? '')
    const graded =
      answer.answer === ''
        ? SKIPPED
        : await gradeAnswer(
            {
              question,
              step: answer.step,
              asked,
              answer: answer.answer,
              firstAnswer: first?.answer,
            },
            {
              interviewer: backend.interviewer(),
              model: settings.models.interviewer,
              settings: settings.interviewer,
              pricing: settings.pricing,
              signal: request.signal,
            },
          )
    state.saveMockTurn({
      sessionId: session.id,
      questionId: question.id,
      step: answer.step,
      prompt: asked,
      answer: answer.answer,
      score: graded.score,
      feedback: graded.feedback,
      citations: JSON.stringify(graded.citations),
      followUp: graded.followUp ?? null,
      costUsd: graded.costUsd,
      answeredAt: backend.now().toISOString(),
    })
    const grade: MockGrade = {
      questionId: question.id,
      step: answer.step,
      score: graded.score,
      feedback: graded.feedback,
      citations: graded.citations,
      ...(graded.followUp === undefined ? {} : { followUp: graded.followUp }),
      ...(answer.step === 'question'
        ? { reference: { answer: question.answer, citation: question.citation } }
        : {}),
      skipped: answer.answer === '',
    }
    return Response.json(grade, { headers: NO_STORE })
  } catch (error) {
    return failure(error)
  }
}

/** GET /api/interview/mock/summary?session=<id>: the end of a mock interview, with no call. */
export function handleMockSummary(factory: BackendFactory, request: Request): Response {
  try {
    const id = new URL(request.url).searchParams.get('session')
    if (id === null || id === '') return fail(400, 'name the interview: ?session=<id>')
    const backend = factory()
    const state = backend.state()
    const session = state.mockSession(id)
    if (session === undefined) return fail(404, `there is no mock interview ${id}`)
    const summary: MockSummary = mockSummary(session, state.mockTurns(id), backend.bank())
    return Response.json(summary, { headers: NO_STORE })
  } catch (error) {
    return failure(error)
  }
}
