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

/** A search of Claude's own, in agentic mode (ADR-0019), as it happens. */
export interface AgentStep {
  query: string
  docTypes: string[]
  /** searching until its results come back. */
  status: 'searching' | 'done'
  /** About how long it waits for the embedding rate limit, while it does. */
  waitMs: number | undefined
  /** Once done: the chunks it added, and how many of its results were already shown. */
  found: number | undefined
  alreadyShown: number | undefined
  trace: RetrievalTrace | undefined
}

export interface AssistantState {
  phase: Phase
  question: string
  /** Asked in agentic mode, where Claude may search again (ADR-0019). */
  agentic: boolean
  trace: RetrievalTrace | undefined
  /** About how long the first search waits for the embedding rate limit, while it does. */
  waitMs: number | undefined
  /** The searches of Claude's own, in order. */
  steps: AgentStep[]
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
export function startState(question: string, agentic = false): AssistantState {
  return {
    phase: 'searching',
    question,
    agentic,
    trace: undefined,
    waitMs: undefined,
    steps: [],
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

/** The last search of Claude's own, changed, while it runs. */
function lastStep(state: AssistantState, change: Partial<AgentStep>): AssistantState {
  const last = state.steps.at(-1)
  if (last?.status !== 'searching') return state
  return { ...state, steps: [...state.steps.slice(0, -1), { ...last, ...change }] }
}

function onEvent(state: AssistantState, event: AnswerEvent): AssistantState {
  switch (event.type) {
    case 'trace':
      return { ...state, phase: 'answering', trace: event.trace, waitMs: undefined }
    case 'wait':
      return state.trace === undefined
        ? { ...state, waitMs: event.ms }
        : lastStep(state, { waitMs: event.ms })
    case 'search':
      return {
        ...state,
        steps: [
          ...state.steps,
          {
            query: event.query,
            docTypes: event.docTypes,
            status: 'searching',
            waitMs: undefined,
            found: undefined,
            alreadyShown: undefined,
            trace: undefined,
          },
        ],
      }
    case 'searched':
      return lastStep(state, {
        status: 'done',
        waitMs: undefined,
        found: event.found,
        alreadyShown: event.alreadyShown,
        trace: event.trace,
      })
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
  | { type: 'ask'; id: number; question: string; agentic?: boolean }
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
      { id: action.id, state: startState(action.question, action.agentic === true) },
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

/** A wait for Voyage's free tier, which allows 3 embedding requests a minute. */
export function waitingText(ms: number): string {
  return `Waiting about ${plural(Math.ceil(ms / 1000), 'second')} for Voyage's rate limit`
}

/** What a finished search of Claude's own brought back. */
export function foundText(step: Pick<AgentStep, 'found' | 'alreadyShown'>): string {
  const found = step.found ?? 0
  const shown = step.alreadyShown ?? 0
  if (found === 0 && shown === 0) return 'no results'
  if (found === 0) return `nothing new: ${plural(shown, 'result')} already shown`
  const fresh = plural(found, 'new result')
  return shown === 0 ? fresh : `${fresh}, ${String(shown)} already shown`
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
      return state.waitMs === undefined ? 'Searching the docs' : waitingText(state.waitMs)
    case 'answering': {
      const step = state.steps.at(-1)
      if (step?.status === 'searching') {
        const searching = `Searching again for "${step.query}"`
        return step.waitMs === undefined ? searching : `${searching}. ${waitingText(step.waitMs)}`
      }
      // In agentic mode the answer arrives whole once Claude has read enough.
      if (!state.agentic) return 'Writing the answer'
      // What the last search brought back is said too, not only shown.
      return step === undefined
        ? 'Reading the results'
        : `Searched again for "${step.query}": ${foundText(step)}. Reading the results`
    }
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
