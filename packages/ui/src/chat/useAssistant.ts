import type { AskRequest } from '@docs-rag-lab/contracts'
import { useCallback, useEffect, useReducer, useRef } from 'react'

import { transcriptReducer, type Exchange } from '../lib/assistant.ts'
import { messageOf } from '../lib/format.ts'
import type { Transport } from '../lib/transport.ts'

export interface Assistant {
  exchanges: readonly Exchange[]
  /** Asks a new question, which adds an exchange. Stops one still running. */
  ask: (request: AskRequest) => Promise<void>
  /** Stops the running question; the app route then stops the Claude stream. */
  stop: () => void
}

/** The chat over a Transport. One question runs at a time. */
export function useAssistant(transport: Transport): Assistant {
  const [exchanges, dispatch] = useReducer(transcriptReducer, [])
  const running = useRef<{ id: number; controller: AbortController } | null>(null)
  const nextId = useRef(1)

  // Leaving the page stops the stream, so it spends no more tokens.
  useEffect(() => () => running.current?.controller.abort(), [])

  const ask = useCallback(
    async (request: AskRequest) => {
      running.current?.controller.abort()
      const controller = new AbortController()
      const id = nextId.current
      nextId.current += 1
      running.current = { id, controller }
      dispatch({ type: 'ask', id, question: request.question, agentic: request.agentic === true })
      try {
        // A response still hands over the events of a chunk it has already read, and
        // an abort ends in an error: the reducer ignores both, the exchange is stopped.
        for await (const event of transport.ask(request, controller.signal)) {
          dispatch({ type: 'update', id, action: { type: 'event', event } })
        }
        dispatch({ type: 'update', id, action: { type: 'ended' } })
      } catch (error) {
        dispatch({ type: 'update', id, action: { type: 'failed', message: messageOf(error) } })
      }
    },
    [transport],
  )

  const stop = useCallback(() => {
    if (running.current === null) return
    const { id, controller } = running.current
    controller.abort()
    dispatch({ type: 'update', id, action: { type: 'stopped' } })
  }, [])

  return { exchanges, ask, stop }
}
