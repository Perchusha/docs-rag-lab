import type { RetrievalRequest } from '@docs-rag-lab/contracts'
import { useCallback, useEffect, useReducer, useRef } from 'react'

import { assistantReducer, initialState, type AssistantState, type Mode } from '../lib/assistant.ts'
import type { Transport } from '../lib/transport.ts'

export interface Assistant {
  state: AssistantState
  /** Asks (retrieval, then a streamed answer) or searches (retrieval only). Stops any earlier run. */
  run(mode: Mode, request: RetrievalRequest): Promise<void>
  /** Stops the running question; the app route then stops the Claude stream. */
  stop(): void
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** One question at a time over a Transport, as AssistantState. */
export function useAssistant(transport: Transport): Assistant {
  const [state, dispatch] = useReducer(assistantReducer, initialState)
  const running = useRef<AbortController | null>(null)

  // Leaving the page stops the stream, so it spends no more tokens.
  useEffect(() => () => running.current?.abort(), [])

  const run = useCallback(
    async (mode: Mode, request: RetrievalRequest) => {
      running.current?.abort()
      const controller = new AbortController()
      running.current = controller
      dispatch({ type: 'start', mode, question: request.question })
      try {
        if (mode === 'search') {
          const trace = await transport.search(request, controller.signal)
          if (!controller.signal.aborted) dispatch({ type: 'searched', trace })
          return
        }
        for await (const event of transport.ask(request, controller.signal)) {
          if (controller.signal.aborted) return
          dispatch({ type: 'event', event })
        }
        if (!controller.signal.aborted) dispatch({ type: 'ended' })
      } catch (error) {
        // An earlier run that a newer one replaced reports nothing.
        if (running.current !== controller) return
        dispatch(
          controller.signal.aborted
            ? { type: 'stopped' }
            : { type: 'failed', message: messageOf(error) },
        )
      }
    },
    [transport],
  )

  const stop = useCallback(() => {
    if (running.current === null) return
    running.current.abort()
    dispatch({ type: 'stopped' })
  }, [])

  return { state, run, stop }
}
