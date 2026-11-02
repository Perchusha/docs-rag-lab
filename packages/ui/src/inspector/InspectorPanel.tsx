import {
  MAX_QUESTION_LENGTH,
  type Citation,
  type RetrievalTrace,
  type Strategy,
  type UsageSummary,
} from '@docs-rag-lab/contracts'
import { useEffect, useId, useRef } from 'react'

import common from '../lib/common.module.css'
import { formatUsage } from '../lib/format.ts'
import type { Transport } from '../lib/transport.ts'
import { Inspector, type InspectorTab } from './Inspector.tsx'
import styles from './InspectorPanel.module.css'

export interface InspectorPanelProps {
  /** What the panel shows: a fresh search's trace, or else the answer's. */
  trace: RetrievalTrace | undefined
  /** The trace the answer came from; undefined until its search has ended. */
  answerTrace: RetrievalTrace | undefined
  usage: UsageSummary | undefined
  citations: readonly Citation[]
  searching: boolean
  error: string | undefined
  strategy: Strategy
  onStrategyChange: (strategy: Strategy) => void
  query: string
  onQueryChange: (query: string) => void
  onSearch: () => void
  selectedChunkId: string | undefined
  onSelectChunk: (chunkId: string) => void
  tab: InspectorTab | undefined
  onTabChange: (tab: InspectorTab) => void
  reveal: string | undefined
  onRevealed: () => void
  /** Moves focus to the heading once, then calls onHeadingFocused. */
  focusHeading: boolean
  onHeadingFocused: () => void
  onClose: () => void
  transport: Transport
}

const METHODS: readonly { value: Strategy; label: string }[] = [
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'vector', label: 'Vector' },
]

/** What a search just did, and what the trace below is. Announced as it changes. */
function statusLine(props: InspectorPanelProps): string {
  const { trace, answerTrace, strategy } = props
  if (props.searching) return 'Searching the docs, with no Claude call.'
  if (props.error !== undefined) return `Error: ${props.error}`
  if (trace === undefined) return ''
  if (trace !== answerTrace) {
    const fresh = `Showing a fresh ${trace.strategy} search, with no Claude call.`
    return answerTrace === undefined
      ? fresh
      : `${fresh} The answer came from ${answerTrace.strategy} search.`
  }
  return trace.strategy === strategy
    ? 'Changing the method or searching again makes no Claude call.'
    : `The answer came from ${trace.strategy} search. New questions will use ${strategy} search.`
}

/**
 * The retrieval inspector, opened on demand, with the retrieval controls in its
 * header. Everything in the header searches without a Claude call. Esc closes it.
 */
export function InspectorPanel(props: InspectorPanelProps) {
  const { query, onQueryChange, onSearch, onClose, focusHeading, onHeadingFocused, usage } = props
  const id = useId()
  const heading = useRef<HTMLHeadingElement>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!focusHeading) return
    heading.current?.focus()
    onHeadingFocused()
  }, [focusHeading, onHeadingFocused])

  return (
    <aside
      className={styles.panel}
      aria-labelledby={`${id}-title`}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose()
      }}
    >
      <div className={styles.titleRow}>
        <h2 id={`${id}-title`} ref={heading} tabIndex={-1}>
          Retrieval inspector
        </h2>
        <button
          type="button"
          className={styles.close}
          aria-label="Close the inspector"
          onClick={onClose}
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
      <div className={styles.controls}>
        <fieldset className={styles.toggle}>
          <legend className={common.srOnly}>Search method</legend>
          {METHODS.map(({ value, label }) => (
            <label key={value} className={props.strategy === value ? styles.on : styles.off}>
              <input
                type="radio"
                className={common.srOnly}
                name={`${id}-strategy`}
                checked={props.strategy === value}
                onChange={() => {
                  props.onStrategyChange(value)
                }}
              />
              {label}
            </label>
          ))}
        </fieldset>
        <form
          className={styles.search}
          onSubmit={(event) => {
            event.preventDefault()
            if (query.trim() === '') input.current?.focus()
            else onSearch()
          }}
        >
          <label className={common.srOnly} htmlFor={`${id}-query`}>
            Search for
          </label>
          <input
            ref={input}
            id={`${id}-query`}
            className={styles.query}
            maxLength={MAX_QUESTION_LENGTH}
            value={query}
            onChange={(event) => {
              onQueryChange(event.target.value)
            }}
          />
          <button type="submit" className={common.button}>
            Search only
          </button>
        </form>
      </div>
      <p role="status" className={styles.note}>
        {statusLine(props)}
      </p>
      {usage !== undefined && <p className={styles.note}>The answer used {formatUsage(usage)}</p>}
      <Inspector
        trace={props.trace}
        citations={props.citations}
        selectedChunkId={props.selectedChunkId}
        onSelectChunk={props.onSelectChunk}
        tab={props.tab}
        onTabChange={props.onTabChange}
        reveal={props.reveal}
        onRevealed={props.onRevealed}
        transport={props.transport}
      />
    </aside>
  )
}
