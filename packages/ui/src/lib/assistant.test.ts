import { NO_CONTEXT, type AnswerEvent } from '@docs-rag-lab/contracts'
import { describe, expect, it } from 'vitest'

import { answerFixture, traces } from '../fixtures.ts'
import {
  assistantReducer,
  foundText,
  isRunning,
  startState,
  statusText,
  transcriptReducer,
  type AssistantAction,
  type AssistantState,
  type Exchange,
} from './assistant.ts'

function run(actions: AssistantAction[], from: AssistantState = startState('q')): AssistantState {
  return actions.reduce(assistantReducer, from)
}

const events = answerFixture.events.map((event) => ({ type: 'event', event }) as const)

describe('assistantReducer', () => {
  it('follows the recorded answer from search to done', () => {
    const searching = startState('q')
    expect(searching.phase).toBe('searching')
    expect(statusText(searching)).toBe('Searching the docs')

    const [trace, ...rest] = events
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

  it('fails when the stream ends early, and on an error event', () => {
    expect(statusText(run([{ type: 'ended' }]))).toBe(
      'Error: the answer stream ended before the answer did',
    )
    const failed = run([{ type: 'event', event: { type: 'error', message: 'overloaded' } }])
    expect(failed.phase).toBe('failed')
    expect(statusText(failed)).toBe('Error: overloaded')
  })

  it('ignores late events once the question is stopped or done', () => {
    const stopped = run([{ type: 'stopped' }])
    expect(statusText(stopped)).toBe('Stopped')
    expect(run([{ type: 'event', event: { type: 'text', text: 'late' } }], stopped)).toBe(stopped)
    expect(run([{ type: 'failed', message: 'aborted' }], stopped)).toBe(stopped)
  })

  it('names the stop reasons that need a word', () => {
    const doneWith = (stopReason: string) =>
      run([{ type: 'event', event: { type: 'done', stopReason, usage: answerFixture.usage } }])
    expect(statusText(doneWith(NO_CONTEXT))).toBe('No indexed chunks to answer from')
    expect(statusText(doneWith('max_tokens'))).toBe(
      'Answer ready, cut off at the length limit, with 0 sources',
    )
    expect(statusText(doneWith('refusal'))).toBe('Claude declined to answer')
  })

  it('announces nothing before the first question', () => {
    expect(statusText(undefined)).toBe('')
  })
})

describe('agentic mode (ADR-0019)', () => {
  const event = (value: AnswerEvent): AssistantAction => ({ type: 'event', event: value })

  it('shows each search of its own as it begins, waits and ends, in what it announces', () => {
    const asked = startState('q', true)
    const waiting = run([event({ type: 'wait', ms: 40_200 })], asked)
    expect(statusText(waiting)).toBe("Waiting about 41 seconds for Voyage's rate limit")

    const read = run([event({ type: 'trace', trace: traces.satisfies })], waiting)
    expect(read.waitMs).toBeUndefined()
    expect(statusText(read)).toBe('Reading the results')

    const searching = run(
      [event({ type: 'search', query: 'satisfies operator', docTypes: ['release-notes'] })],
      read,
    )
    expect(searching.steps).toMatchObject([
      { query: 'satisfies operator', docTypes: ['release-notes'], status: 'searching' },
    ])
    expect(statusText(searching)).toBe('Searching again for "satisfies operator"')

    const held = run([event({ type: 'wait', ms: 53_000 })], searching)
    expect(statusText(held)).toBe(
      'Searching again for "satisfies operator". Waiting about 53 seconds for Voyage\'s rate limit',
    )

    const found = run(
      [event({ type: 'searched', found: 3, alreadyShown: 5, trace: traces.ts2345 })],
      held,
    )
    expect(found.steps).toMatchObject([
      { status: 'done', waitMs: undefined, found: 3, alreadyShown: 5, trace: traces.ts2345 },
    ])
    expect(statusText(found)).toBe('Reading the results')
    expect(isRunning(found)).toBe(true)
  })

  it('says what a search brought back, in the singular too', () => {
    expect(foundText({ found: 3, alreadyShown: 5 })).toBe('3 new results, 5 already shown')
    expect(foundText({ found: 1, alreadyShown: 0 })).toBe('1 new result')
    expect(foundText({ found: 0, alreadyShown: 1 })).toBe('nothing new: 1 result already shown')
    expect(foundText({ found: 0, alreadyShown: 0 })).toBe('no results')
  })

  it('marks an exchange asked in agentic mode', () => {
    const [exchange] = transcriptReducer([], { type: 'ask', id: 1, question: 'q', agentic: true })
    expect(exchange?.state.agentic).toBe(true)
  })
})

describe('transcriptReducer', () => {
  const update = (id: number, action: AssistantAction) => ({ type: 'update', id, action }) as const
  const text = (value: string): AssistantAction => ({
    type: 'event',
    event: { type: 'text', text: value },
  })

  it('adds each question to the chat, keeping the earlier ones', () => {
    const first = transcriptReducer([], { type: 'ask', id: 1, question: 'one' })
    const done = transcriptReducer(first, update(1, { type: 'ended' }))
    const second = transcriptReducer(done, { type: 'ask', id: 2, question: 'two' })
    expect(second.map((e) => [e.id, e.state.question])).toEqual([
      [1, 'one'],
      [2, 'two'],
    ])
  })

  it('sends an update only to its own exchange', () => {
    let list: Exchange[] = transcriptReducer([], { type: 'ask', id: 1, question: 'one' })
    list = transcriptReducer(list, update(1, { type: 'stopped' }))
    list = transcriptReducer(list, { type: 'ask', id: 2, question: 'two' })
    list = transcriptReducer(list, update(2, text('for two')))
    expect(list[0]?.state.parts).toEqual([])
    expect(list[1]?.state.parts).toEqual([{ kind: 'text', text: 'for two' }])
  })

  it('stops a question still running when a new one is asked, and drops what it sends late', () => {
    let list: Exchange[] = transcriptReducer([], { type: 'ask', id: 1, question: 'one' })
    list = transcriptReducer(list, update(1, text('partial')))
    list = transcriptReducer(list, { type: 'ask', id: 2, question: 'two' })
    expect(list[0]?.state.phase).toBe('stopped')
    expect(list[1]?.state.phase).toBe('searching')

    list = transcriptReducer(list, update(1, text(' late')))
    expect(list[0]?.state.parts).toEqual([{ kind: 'text', text: 'partial' }])
  })
})
