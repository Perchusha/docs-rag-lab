// The state of one question, from the click to the last event. A pure reducer,
// so every transition is unit tested; useAssistant wires it to a Transport.
import {
  NO_CONTEXT,
  type AnswerEvent,
  type Citation,
  type RetrievalTrace,
  type UsageSummary,
} from '@docs-rag-lab/contracts'

import { appendCitations, appendText, type AnswerPart } from './answer.ts'

export type Mode = 'ask' | 'search'

/**
 * idle: nothing asked yet. searching: waiting for the trace. answering: the
 * trace is in and the answer streams. done, stopped and failed are final.
 */
export type Phase = 'idle' | 'searching' | 'answering' | 'done' | 'stopped' | 'failed'

export interface AssistantState {
  phase: Phase
  mode: Mode
  question: string
  trace: RetrievalTrace | undefined
  parts: AnswerPart[]
  citations: Citation[]
  usage: UsageSummary | undefined
  stopReason: string | null | undefined
  error: string | undefined
}

export type AssistantAction =
  | { type: 'start'; mode: Mode; question: string }
  | { type: 'event'; event: AnswerEvent }
  | { type: 'searched'; trace: RetrievalTrace }
  /** The stream ended. Without a done or error event first, that is a failure. */
  | { type: 'ended' }
  | { type: 'stopped' }
  | { type: 'failed'; message: string }

export const initialState: AssistantState = {
  phase: 'idle',
  mode: 'ask',
  question: '',
  trace: undefined,
  parts: [],
  citations: [],
  usage: undefined,
  stopReason: undefined,
  error: undefined,
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

export function assistantReducer(state: AssistantState, action: AssistantAction): AssistantState {
  switch (action.type) {
    case 'start':
      return { ...initialState, phase: 'searching', mode: action.mode, question: action.question }
    case 'event':
      return isRunning(state) ? onEvent(state, action.event) : state
    case 'searched':
      return isRunning(state) ? { ...state, phase: 'done', trace: action.trace } : state
    case 'ended':
      return isRunning(state)
        ? { ...state, phase: 'failed', error: 'the answer stream ended before the answer did' }
        : state
    case 'stopped':
      return isRunning(state) ? { ...state, phase: 'stopped' } : state
    case 'failed':
      return isRunning(state) ? { ...state, phase: 'failed', error: action.message } : state
  }
}

function plural(n: number, word: string): string {
  return `${String(n)} ${word}${n === 1 ? '' : 's'}`
}

/**
 * What the polite live region announces. The streaming answer itself is not
 * a live region, or a screen reader would read every delta; this says when
 * the state changes instead.
 */
export function statusText(state: AssistantState): string {
  switch (state.phase) {
    case 'idle':
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
      const context = state.trace?.context.length ?? 0
      if (state.mode === 'search') return `Search done: ${plural(context, 'chunk')} in the context`
      if (state.stopReason === NO_CONTEXT) return 'No indexed chunks to answer from'
      const sources = plural(state.citations.length, 'source')
      if (state.stopReason === 'max_tokens')
        return `Answer ready, cut off at the length limit, with ${sources}`
      if (state.stopReason === 'refusal') return 'Claude declined to answer'
      return `Answer ready, with ${sources}`
    }
  }
}
