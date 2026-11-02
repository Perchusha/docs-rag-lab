import { NO_CONTEXT } from '@docs-rag-lab/contracts'
import { describe, expect, it } from 'vitest'

import { answerFixture, traces } from '../fixtures.ts'
import {
  assistantReducer,
  initialState,
  isRunning,
  statusText,
  type AssistantAction,
  type AssistantState,
} from './assistant.ts'

function run(actions: AssistantAction[], from: AssistantState = initialState): AssistantState {
  return actions.reduce(assistantReducer, from)
}

const ask: AssistantAction = { type: 'start', mode: 'ask', question: 'q' }

describe('assistantReducer', () => {
  it('follows the recorded answer from search to done', () => {
    const searching = run([ask])
    expect(searching.phase).toBe('searching')
    expect(statusText(searching)).toBe('Searching the docs')

    const [trace, ...rest] = answerFixture.events.map(
      (event) => ({ type: 'event', event }) as const,
    )
    const answering = run(trace === undefined ? [] : [trace], searching)
    expect(answering.phase).toBe('answering')
    expect(answering.trace?.context).toHaveLength(8)
    expect(statusText(answering)).toBe('Writing the answer')

    const done = run([...rest, { type: 'ended' }], answering)
    expect(done.phase).toBe('done')
    expect(done.parts).toEqual(answerFixture.parts)
    expect(done.citations).toEqual(answerFixture.citations)
    expect(done.usage).toEqual(answerFixture.usage)
    expect(statusText(done)).toBe('Answer ready, with 1 source')
    expect(isRunning(done)).toBe(false)
  })

  it('reports search-only results by the size of the context', () => {
    const done = run([
      { type: 'start', mode: 'search', question: 'q' },
      { type: 'searched', trace: traces.satisfies },
    ])
    expect(statusText(done)).toBe('Search done: 8 chunks in the context')
  })

  it('a new question starts from scratch', () => {
    const done = run([
      ask,
      ...answerFixture.events.map((event) => ({ type: 'event', event }) as const),
    ])
    const again = run([{ type: 'start', mode: 'search', question: 'other' }], done)
    expect(again).toEqual({
      ...initialState,
      phase: 'searching',
      mode: 'search',
      question: 'other',
    })
  })

  it('fails when the stream ends early, and on an error event', () => {
    expect(statusText(run([ask, { type: 'ended' }]))).toBe(
      'Error: the answer stream ended before the answer did',
    )
    const failed = run([ask, { type: 'event', event: { type: 'error', message: 'overloaded' } }])
    expect(failed.phase).toBe('failed')
    expect(statusText(failed)).toBe('Error: overloaded')
  })

  it('ignores late events once the question is stopped or done', () => {
    const stopped = run([ask, { type: 'stopped' }])
    expect(statusText(stopped)).toBe('Stopped')
    expect(run([{ type: 'event', event: { type: 'text', text: 'late' } }], stopped)).toBe(stopped)
    expect(run([{ type: 'failed', message: 'aborted' }], stopped)).toBe(stopped)
    expect(run([{ type: 'stopped' }], initialState)).toBe(initialState)
  })

  it('names the stop reasons that need a word', () => {
    const doneWith = (stopReason: string) =>
      run([
        ask,
        {
          type: 'event',
          event: { type: 'done', stopReason, usage: answerFixture.usage },
        },
      ])
    expect(statusText(doneWith(NO_CONTEXT))).toBe('No indexed chunks to answer from')
    expect(statusText(doneWith('max_tokens'))).toBe(
      'Answer ready, cut off at the length limit, with 0 sources',
    )
    expect(statusText(doneWith('refusal'))).toBe('Claude declined to answer')
  })
})
