import type { AnswerEvent } from '@docs-rag-lab/contracts'
import { describe, expect, it, vi } from 'vitest'

import { traces } from '../fixtures.ts'
import { replayGate, replayTransport } from './replay.ts'

const events: AnswerEvent[] = [
  { type: 'text', text: 'one' },
  { type: 'text', text: 'two' },
  { type: 'text', text: 'three' },
]

/** Lets every promise that can settle right now do so. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/** Reads a stream in the background, keeping what has arrived so far. */
function collect(stream: AsyncIterable<AnswerEvent>) {
  const seen: AnswerEvent[] = []
  const done = (async () => {
    for await (const event of stream) seen.push(event)
  })()
  return { seen, done }
}

describe('replayGate', () => {
  it('holds a step until it is released, for as long as it takes', async () => {
    const gate = replayGate()
    let passed = false
    void gate.pass().then(() => {
      passed = true
    })
    await settle()
    expect(passed).toBe(false)
    gate.release()
    await settle()
    expect(passed).toBe(true)
  })

  it('counts a release that comes before the step', async () => {
    const gate = replayGate()
    gate.release(2)
    await expect(gate.pass()).resolves.toBeUndefined()
    await expect(gate.pass()).resolves.toBeUndefined()
    let third = false
    void gate.pass().then(() => {
      third = true
    })
    await settle()
    expect(third).toBe(false)
  })

  it('open lets everything through, and reset closes it again', async () => {
    const gate = replayGate()
    gate.open()
    await expect(gate.pass()).resolves.toBeUndefined()
    gate.reset()
    let passed = false
    void gate.pass().then(() => {
      passed = true
    })
    await settle()
    expect(passed).toBe(false)
  })
})

describe('replayTransport with a gate', () => {
  it('sends only as many events as the test releases', async () => {
    const gate = replayGate()
    const onAskEnd = vi.fn()
    const signal = new AbortController().signal
    const { seen, done } = collect(
      replayTransport({ events, gate, onAskEnd }).ask({ question: 'q' }, signal),
    )

    await settle()
    expect(seen).toEqual([])
    gate.release(2)
    await settle()
    expect(seen).toEqual(events.slice(0, 2))
    expect(onAskEnd).not.toHaveBeenCalled()

    gate.open()
    await done
    expect(seen).toEqual(events)
    expect(onAskEnd).toHaveBeenCalledExactlyOnceWith('finished')
  })

  it('stops at an abort, even with the gate closed', async () => {
    const gate = replayGate()
    const onAskEnd = vi.fn()
    const controller = new AbortController()
    const { seen, done } = collect(
      replayTransport({ events, gate, onAskEnd }).ask({ question: 'q' }, controller.signal),
    )
    gate.release()
    await settle()
    controller.abort()
    await expect(done).rejects.toThrow()
    expect(seen).toEqual(events.slice(0, 1))
    expect(onAskEnd).toHaveBeenCalledExactlyOnceWith('aborted')
  })

  it('keeps sending after an abort when told to, as a response does with a chunk it has read', async () => {
    const gate = replayGate()
    const onAskEnd = vi.fn()
    const controller = new AbortController()
    const { seen, done } = collect(
      replayTransport({ events, gate, ignoresAbort: true, onAskEnd }).ask(
        { question: 'q' },
        controller.signal,
      ),
    )
    controller.abort()
    gate.open()
    await done
    expect(seen).toEqual(events)
    expect(onAskEnd).toHaveBeenCalledExactlyOnceWith('aborted')
  })

  it('answers search() per method, and can fail it alone', async () => {
    const signal = new AbortController().signal
    const transport = replayTransport({
      trace: traces.satisfies,
      searchTraces: { vector: traces.satisfiesVector },
    })
    await expect(transport.search({ question: 'q', strategy: 'vector' }, signal)).resolves.toBe(
      traces.satisfiesVector,
    )
    await expect(transport.search({ question: 'q', strategy: 'hybrid' }, signal)).resolves.toBe(
      traces.satisfies,
    )

    const failing = replayTransport({ events, searchFailure: 'overloaded' })
    await expect(failing.search({ question: 'q' }, signal)).rejects.toThrow('overloaded')
    const { seen, done } = collect(failing.ask({ question: 'q' }, signal))
    await done
    expect(seen).toEqual(events)
  })

  it('holds each method on its own gate, and can ignore an abort', async () => {
    const older = replayGate()
    const newer = replayGate()
    const controller = new AbortController()
    const transport = replayTransport({
      trace: traces.satisfies,
      searchTraces: { vector: traces.satisfiesVector },
      searchGates: { vector: older, hybrid: newer },
      ignoresAbort: true,
    })
    const finished: string[] = []
    const search = (strategy: 'vector' | 'hybrid') =>
      transport.search({ question: 'q', strategy }, controller.signal).then(() => {
        finished.push(strategy)
      })
    const searches = [search('vector'), search('hybrid')]
    controller.abort()
    newer.open()
    await settle()
    expect(finished).toEqual(['hybrid'])
    older.open()
    await Promise.all(searches)
    expect(finished).toEqual(['hybrid', 'vector'])
  })

  it('holds search() on its own gate', async () => {
    const searchGate = replayGate()
    const trace = { question: 'q' } as never
    let answered = false
    const signal = new AbortController().signal
    void replayTransport({ trace, searchGate })
      .search({ question: 'q' }, signal)
      .then(() => {
        answered = true
      })
    await settle()
    expect(answered).toBe(false)
    searchGate.release()
    await settle()
    expect(answered).toBe(true)
  })
})
