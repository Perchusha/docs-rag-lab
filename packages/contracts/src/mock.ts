// The interview-prep app's mock interview (ADR-0018): a fixed loop. The interviewer asks a
// generated question from the bank, hybrid search retrieves passages for the answer, and Claude
// grades it against them, with citations, a score of 0 to 2 and one follow-up. After the last
// question, the summary names the weak topics and three sections to read.
import type { QuestionCitation, QuestionCode, QuestionKind } from './interview.ts'

/** The first answer to a question, then the answer to its follow-up. */
export const MOCK_STEPS = ['question', 'follow-up'] as const
export type MockStep = (typeof MOCK_STEPS)[number]

/** 0: wrong or missing, 1: partly right, 2: right and complete. */
export type MockScore = 0 | 1 | 2

/** The longest answer a route accepts, in characters. */
export const MAX_MOCK_ANSWER = 4_000

/** A question the interviewer asks, without the bank's answer, which comes with the grade. */
export interface MockQuestion {
  /** The bank question's ID. */
  id: string
  source: string
  kind: QuestionKind
  topicTitle: string
  prompt: string
  code?: QuestionCode
}

export interface MockStartRequest {
  /** The chosen technologies, by source ID. */
  sources: string[]
}

export interface MockSession {
  id: string
  questions: MockQuestion[]
}

/** An answer to a question or to its follow-up. An empty answer skips it, with no call. */
export interface MockAnswerRequest {
  sessionId: string
  questionId: string
  step: MockStep
  answer: string
}

/** A passage the feedback cites, by the number its markers use. */
export interface MockCitation {
  number: number
  /** The doc URL with the section anchor. */
  url: string
  title: string
}

export interface MockGrade {
  questionId: string
  step: MockStep
  score: MockScore
  /** What was right and what was missing, with [n] markers for its citations. */
  feedback: string
  citations: MockCitation[]
  /** The interviewer's follow-up, after a first answer that was not skipped. */
  followUp?: string
  /** The bank's answer and where it is in the docs, after the first answer. */
  reference?: { answer: string; citation: QuestionCitation }
  /** An empty answer: scored 0, with no call to any model. */
  skipped: boolean
}

/** One question of a finished interview, with its score over both steps. */
export interface MockQuestionResult {
  questionId: string
  source: string
  topicTitle: string
  prompt: string
  score: number
  /** 2 per answered step. */
  max: number
}

/** A topic the interview found weak: one of its answers scored below 2. */
export interface MockWeakTopic {
  source: string
  topicId: string
  title: string
  score: number
  max: number
}

export interface MockSummary {
  sessionId: string
  /** The questions answered, in the order they were asked. */
  questions: MockQuestionResult[]
  score: number
  max: number
  /** Weakest first. */
  weakTopics: MockWeakTopic[]
  /** Up to three sections to read, from the weakest answers first. */
  read: { url: string; title: string }[]
  /** What grading cost, estimated at list prices. */
  costUsd: number
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** A start request as JSON, checked. Anything else gives undefined. */
export function parseMockStartRequest(value: unknown): MockStartRequest | undefined {
  if (!isRecord(value)) return undefined
  const { sources } = value
  if (!Array.isArray(sources) || sources.length === 0) return undefined
  if (!sources.every((source): source is string => typeof source === 'string' && source !== '')) {
    return undefined
  }
  return { sources }
}

/** An answer request as JSON, checked, with the answer trimmed. Anything else gives undefined. */
export function parseMockAnswerRequest(value: unknown): MockAnswerRequest | undefined {
  if (!isRecord(value)) return undefined
  const { sessionId, questionId, step, answer } = value
  if (typeof sessionId !== 'string' || sessionId === '') return undefined
  if (typeof questionId !== 'string' || questionId === '') return undefined
  const known = MOCK_STEPS.find((name) => name === step)
  if (known === undefined || typeof answer !== 'string') return undefined
  const trimmed = answer.trim()
  if (trimmed.length > MAX_MOCK_ANSWER) return undefined
  return { sessionId, questionId, step: known, answer: trimmed }
}
