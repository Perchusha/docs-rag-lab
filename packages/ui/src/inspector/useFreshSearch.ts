import type { RetrievalRequest, RetrievalTrace } from '@docs-rag-lab/contracts'
import { useCallback, useEffect, useRef, useState } from 'react'

import { messageOf } from '../lib/format.ts'
import type { Transport } from '../lib/transport.ts'

export interface FreshSearch {
  /** The last search's trace, until a reset. It stays while a newer search runs. */
  trace: RetrievalTrace | undefined
  searching: boolean
  error: string | undefined
  search: (request: RetrievalRequest) => void
  /** Drops the trace and stops a search still running. */
  reset: () => void
}

const NOTHING = { trace: undefined, searching: false, error: undefined }

/**
 * A search from the inspector, with no Claude call. It has its own abort, so it
 * never touches a streaming answer, and a newer search replaces an older one.
 */
export function useFreshSearch(transport: Transport): FreshSearch {
  const [state, setState] = useState<Pick<FreshSearch, 'trace' | 'searching' | 'error'>>(NOTHING)
  const running = useRef<AbortController | null>(null)

  useEffect(() => () => running.current?.abort(), [])

  const search = useCallback(
    (request: RetrievalRequest) => {
      running.current?.abort()
      const controller = new AbortController()
      running.current = controller
      setState((current) => ({ ...current, searching: true, error: undefined }))
      transport.search(request, controller.signal).then(
        (trace) => {
          if (controller.signal.aborted) return
          setState({ trace, searching: false, error: undefined })
        },
        (error: unknown) => {
          if (controller.signal.aborted) return
          setState((current) => ({ ...current, searching: false, error: messageOf(error) }))
        },
      )
    },
    [transport],
  )

  const reset = useCallback(() => {
    running.current?.abort()
    setState(NOTHING)
  }, [])

  return { ...state, search, reset }
}
