import type { Citation, RetrievalRequest, Strategy } from '@docs-rag-lab/contracts'
import { useCallback, useRef, useState } from 'react'

import type { Exchange } from '../lib/assistant.ts'
import type { Transport } from '../lib/transport.ts'
import type { InspectorTab } from './Inspector.tsx'
import type { InspectorPanelProps } from './InspectorPanel.tsx'
import { useFreshSearch } from './useFreshSearch.ts'

export interface InspectorPanelOptions {
  transport: Transport
  exchanges: readonly Exchange[]
  defaultStrategy: Strategy
  /** The request for a question, with what the page has chosen. */
  requestFor: (question: string, strategy: Strategy) => RetrievalRequest
  /** Where focus goes on closing, when what opened the panel has gone. */
  focusFallback: () => void
}

export interface InspectorPanelState {
  /** The exchange the panel is about; undefined while it is closed. */
  shown: Exchange | undefined
  /** The method the toggle shows, which the next question uses too. */
  strategy: Strategy
  /** For a new question: an open panel moves on to it. */
  followQuestion: (question: string) => void
  /** "How was this found?": opens the panel on this exchange, or closes it. */
  toggle: (exchange: Exchange, button: HTMLElement) => void
  /** Opens the panel on the chunk a citation cites. */
  showCitation: (exchange: Exchange, citation: Citation, trigger: HTMLElement) => void
  /** What the panel renders; undefined while it is closed. */
  panel: InspectorPanelProps | undefined
}

/** The inspector, which opens on demand: what it shows, and where focus goes. */
export function useInspectorPanel(options: InspectorPanelOptions): InspectorPanelState {
  const { transport, exchanges, requestFor, focusFallback } = options
  const fresh = useFreshSearch(transport)
  // Its own search, so that the comparison never replaces the trace it compares.
  const compare = useFreshSearch(transport)
  const trigger = useRef<HTMLElement | null>(null)
  const [target, setTarget] = useState<number | 'latest' | undefined>(undefined)
  const [strategy, setStrategy] = useState(options.defaultStrategy)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | undefined>(undefined)
  const [tab, setTab] = useState<InspectorTab | undefined>(undefined)
  const [reveal, setReveal] = useState<string | undefined>(undefined)
  const [focusHeading, setFocusHeading] = useState(false)
  const revealed = useCallback(() => {
    setReveal(undefined)
  }, [])
  const headingFocused = useCallback(() => {
    setFocusHeading(false)
  }, [])

  const shown = target === 'latest' ? exchanges.at(-1) : exchanges.find((e) => e.id === target)

  /** Points the panel at an exchange, from a clean start. */
  const showExchange = (next: number | 'latest', question: string) => {
    fresh.reset()
    compare.reset()
    setTarget(next)
    setQuery(question)
    setSelected(undefined)
    setTab(undefined)
    setReveal(undefined)
  }

  const close = () => {
    fresh.reset()
    compare.reset()
    setTarget(undefined)
    setReveal(undefined)
    setFocusHeading(false)
    if (trigger.current?.isConnected === true) trigger.current.focus()
    else focusFallback()
  }

  const search = (text: string, method: Strategy) => {
    const question = text.trim()
    if (question === '') return
    // The new trace may not have the selected chunk, and only hybrid search has
    // a fusion to show: back to the default tab, which for vector search is Lists.
    setSelected(undefined)
    setReveal(undefined)
    setTab((current) => (current === 'fusion' ? undefined : current))
    compare.reset()
    fresh.search(requestFor(question, method))
  }

  const shownTrace = fresh.trace ?? shown?.state.trace

  return {
    shown,
    strategy,
    followQuestion: (question) => {
      if (target === undefined) return
      // What opened the panel belongs to an earlier answer now.
      trigger.current = null
      showExchange('latest', question)
    },
    toggle: (exchange, button) => {
      trigger.current = button
      if (shown?.id === exchange.id) {
        close()
        return
      }
      showExchange(exchange.id, exchange.state.question)
      setFocusHeading(true)
    },
    showCitation: (exchange, citation, button) => {
      trigger.current = button
      // A citation points into the answer's own trace, not into a fresh search.
      showExchange(exchange.id, exchange.state.question)
      setFocusHeading(false)
      setSelected(citation.chunkId)
      setTab('context')
      setReveal(citation.chunkId)
    },
    panel:
      shown === undefined
        ? undefined
        : {
            trace: shownTrace,
            answerTrace: shown.state.trace,
            usage: shown.state.usage,
            citations: shown.state.citations,
            searching: fresh.searching,
            error: fresh.error,
            strategy,
            onStrategyChange: (value) => {
              setStrategy(value)
              search(query, value)
            },
            query,
            onQueryChange: setQuery,
            onSearch: () => {
              search(query, strategy)
            },
            selectedChunkId: selected,
            onSelectChunk: setSelected,
            tab,
            onTabChange: setTab,
            reveal,
            onRevealed: revealed,
            focusHeading,
            onHeadingFocused: headingFocused,
            onClose: close,
            rerank: {
              trace: compare.trace,
              running: compare.searching,
              error: compare.error,
              onCompare: () => {
                if (shownTrace === undefined) return
                // What the panel shows, whatever the field or the page's filter now say.
                compare.search({
                  ...requestFor(shownTrace.question, 'rerank'),
                  docTypes: shownTrace.filters.docTypes,
                })
              },
              onStop: compare.reset,
            },
            transport,
          },
  }
}
