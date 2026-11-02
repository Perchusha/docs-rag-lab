// The state of the chat: a list of exchanges, each one question from the moment
// it is asked to its last event. Pure reducers, so every transition is unit
// tested; useAssistant wires them to a Transport.
import {
  NO_CONTEXT,
  type AnswerEvent,
  type Citation,
  type RetrievalTrace,
  type UsageSummary,
} from '@docs-rag-lab/contracts'

import { appendCitations, appendText, type AnswerPart } from './answer.ts'

/**
 * searching: waiting for the trace. answering: the trace is in and the answer
 * streams. done, stopped and failed are final.
 */
export type Phase = 'searching' | 'answering' | 'done' | 'stopped' | 'failed'

export interface AssistantState {
  phase: Phase
  question: string
  trace: RetrievalTrace | undefined
  parts: AnswerPart[]
  citations: Citation[]
  usage: UsageSummary | undefined
  stopReason: string | null | undefined
  error: string | undefined
}

export type AssistantAction =
  | { type: 'event'; event: AnswerEvent }
  /** The stream ended. Without a done or error event first, that is a failure. */
  | { type: 'ended' }
  | { type: 'stopped' }
  | { type: 'failed'; message: string }

/** A question just asked. */
export function startState(question: string): AssistantState {
  return {
    phase: 'searching',
    question,
    trace: undefined,
    parts: [],
    citations: [],
    usage: undefined,
    stopReason: undefined,
    error: undefined,
  }
}

const RUNNING: ReadonlySet<Phase> = new Set(['searching', 'answering'])

export function isRunning(state: AssistantState): boolean {
  return RUNNING.has(state.phase)
}

function onEvent(state: AssistantState, event: AnswerEvent): AssistantState {
  switch (event.type) {
    case 'trace':
      return { ...state, phase: 'answering', trace: event.trace }
    case 'text':
      return { ...state, parts: appendText(state.parts, event.text) }
    case 'citations':
      return {
        ...state,
        parts: appendCitations(state.parts, event.numbers),
        citations: [...state.citations, ...event.citations],
      }
    case 'done':
      return { ...state, phase: 'done', usage: event.usage, stopReason: event.stopReason }
    case 'error':
      return { ...state, phase: 'failed', error: event.message }
  }
}

/** One exchange. Once it has ended, whatever still arrives is ignored. */
export function assistantReducer(state: AssistantState, action: AssistantAction): AssistantState {
  if (!isRunning(state)) return state
  switch (action.type) {
    case 'event':
      return onEvent(state, action.event)
    case 'ended':
      return {
        ...state,
        phase: 'failed',
        error: 'the answer stream ended before the answer did',
      }
    case 'stopped':
      return { ...state, phase: 'stopped' }
    case 'failed':
      return { ...state, phase: 'failed', error: action.message }
  }
}

export interface Exchange {
  id: number
  state: AssistantState
}

export type TranscriptAction =
  /** A new question. It stops one still running, which stays in the chat as it is. */
  | { type: 'ask'; id: number; question: string }
  | { type: 'update'; id: number; action: AssistantAction }

export function transcriptReducer(
  exchanges: readonly Exchange[],
  action: TranscriptAction,
): Exchange[] {
  if (action.type === 'ask') {
    return [
      ...exchanges.map((exchange) => ({
        ...exchange,
        state: assistantReducer(exchange.state, { type: 'stopped' }),
      })),
      { id: action.id, state: startState(action.question) },
    ]
  }
  return exchanges.map((exchange) =>
    exchange.id === action.id
      ? { ...exchange, state: assistantReducer(exchange.state, action.action) }
      : exchange,
  )
}

function plural(n: number, word: string): string {
  return `${String(n)} ${word}${n === 1 ? '' : 's'}`
}

/**
 * What the polite live region announces. The streaming answer itself is not
 * a live region, or a screen reader would read every delta; this says when
 * the state changes instead.
 */
export function statusText(state: AssistantState | undefined): string {
  switch (state?.phase) {
    case undefined:
      return ''
    case 'searching':
      return 'Searching the docs'
    case 'answering':
      return 'Writing the answer'
    case 'stopped':
      return 'Stopped'
    case 'failed':
      return `Error: ${state.error ?? 'unknown'}`
    case 'done': {
      if (state.stopReason === NO_CONTEXT) return 'No indexed chunks to answer from'
      const sources = plural(state.citations.length, 'source')
      if (state.stopReason === 'max_tokens') {
        return `Answer ready, cut off at the length limit, with ${sources}`
      }
      if (state.stopReason === 'refusal') return 'Claude declined to answer'
      return `Answer ready, with ${sources}`
    }
  }
}
