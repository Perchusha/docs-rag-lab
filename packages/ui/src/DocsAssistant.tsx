'use client'
// A docs assistant: a chat column for someone asking a question, and the
// retrieval inspector, on demand, for someone exploring how it was found (SPEC
// section 13, M3). An app renders this from a server component with its config:
// serializable props only, so the transport is built here from the endpoints
// unless a story or test passes its own.
import type { RetrievalRequest, Strategy } from '@docs-rag-lab/contracts'
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'

import { Answer } from './chat/Answer.tsx'
import { Composer, type ComposerHandle } from './chat/Composer.tsx'
import { useAssistant } from './chat/useAssistant.ts'
import styles from './DocsAssistant.module.css'
import { InspectorPanel } from './inspector/InspectorPanel.tsx'
import { useInspectorPanel } from './inspector/useInspectorPanel.ts'
import { isRunning, statusText } from './lib/assistant.ts'
import common from './lib/common.module.css'
import { fetchTransport, type Endpoints, type Transport } from './lib/transport.ts'
import './tokens.css'

export interface Theme {
  /** Must reach 4.5:1 against white (light) and against #0d1117 (dark). */
  accent: { light: string; dark: string }
}

export interface DocsAssistantProps {
  title: string
  tagline?: string | undefined
  /** The source to ask; the engine's default when missing. */
  sourceId?: string | undefined
  examples: readonly string[]
  /** The input's placeholder before the first question. */
  placeholder?: string | undefined
  /** The source's doc types, for the filter. */
  docTypes: readonly string[]
  /** Plain-language names for the doc types, for the filter. */
  docTypeLabels?: Readonly<Record<string, string>> | undefined
  defaultStrategy: Strategy
  theme?: Theme | undefined
  endpoints: Endpoints
  /** Replaces fetch over the endpoints, for stories and tests. */
  transport?: Transport | undefined
}

export function DocsAssistant(props: DocsAssistantProps) {
  const { title, sourceId, endpoints, theme } = props
  const transport = useMemo(
    () => props.transport ?? fetchTransport(endpoints),
    [props.transport, endpoints],
  )
  const { exchanges, ask, stop } = useAssistant(transport)
  const composer = useRef<ComposerHandle>(null)
  const latestAnswer = useRef<HTMLDivElement>(null)
  const dock = useRef<HTMLDivElement>(null)
  const [filter, setFilter] = useState<string[]>([])

  const requestFor = (question: string, strategy: Strategy): RetrievalRequest => ({
    question,
    strategy,
    docTypes: filter,
    ...(sourceId === undefined ? {} : { source: sourceId }),
  })
  const inspector = useInspectorPanel({
    transport,
    exchanges,
    defaultStrategy: props.defaultStrategy,
    requestFor,
    focusFallback: () => composer.current?.focus(),
  })

  const latest = exchanges.at(-1)
  const empty = latest === undefined
  const running = latest !== undefined && isRunning(latest.state)

  const send = (question: string) => {
    inspector.followQuestion(question)
    void ask(requestFor(question, inspector.strategy))
  }

  // An example disappears as it sends, so focus moves on to the input.
  const sendExample = (question: string) => {
    send(question)
    composer.current?.focus()
  }

  // A new question comes into view; the answer then grows below it at its own pace.
  const count = exchanges.length
  useEffect(() => {
    if (count > 0) latestAnswer.current?.scrollIntoView({ block: 'start' })
  }, [count])

  // The input's real height, which grows with its text: the page keeps that much
  // clear when it scrolls something into view (tokens.css).
  useEffect(() => {
    const element = dock.current
    if (element === null) return
    const page = document.documentElement
    const observer = new ResizeObserver(() => {
      page.style.setProperty('--dock-height', `${String(element.offsetHeight)}px`)
    })
    observer.observe(element)
    return () => {
      observer.disconnect()
      page.style.removeProperty('--dock-height')
    }
  }, [])

  const style =
    theme === undefined
      ? undefined
      : ({
          '--accent-light': theme.accent.light,
          '--accent-dark': theme.accent.dark,
        } as CSSProperties)

  const { panel } = inspector
  const layout = [styles.layout, panel === undefined ? undefined : styles.withInspector]
  const chat = [styles.chat, empty ? styles.empty : undefined]
  return (
    <div className={styles.root} data-drl-theme="" style={style}>
      {/* The panel is a top-level landmark, so it is beside main, not in it. */}
      <div className={layout.filter(Boolean).join(' ')}>
        <main className={chat.filter(Boolean).join(' ')}>
          <header className={styles.header}>
            <h1>{title}</h1>
            {empty && props.tagline !== undefined && (
              <p className={styles.tagline}>{props.tagline}</p>
            )}
          </header>
          {!empty && (
            <div className={styles.transcript}>
              {exchanges.map((exchange) => (
                <div key={exchange.id} ref={exchange.id === latest.id ? latestAnswer : undefined}>
                  <Answer
                    state={exchange.state}
                    onCitation={(citation, trigger) => {
                      inspector.showCitation(exchange, citation, trigger)
                    }}
                    actions={
                      exchange.state.trace !== undefined && !isRunning(exchange.state) ? (
                        <button
                          type="button"
                          className={styles.how}
                          aria-expanded={inspector.shown?.id === exchange.id}
                          onClick={(event) => {
                            inspector.toggle(exchange, event.currentTarget)
                          }}
                        >
                          How was this found?
                        </button>
                      ) : undefined
                    }
                  />
                </div>
              ))}
            </div>
          )}
          <div ref={dock} className={styles.dock}>
            {/* Announced in every state, but only worth seeing while something runs. */}
            <p role="status" className={running ? styles.status : common.srOnly}>
              {statusText(latest?.state)}
            </p>
            <Composer
              ref={composer}
              placeholder={empty ? (props.placeholder ?? 'Ask a question') : 'Ask a new question'}
              docTypes={props.docTypes}
              docTypeLabels={props.docTypeLabels}
              filter={filter}
              onFilterChange={setFilter}
              running={running}
              onSend={send}
              onStop={stop}
            />
            {empty && props.examples.length > 0 && (
              <ul className={styles.examples} aria-label="Example questions">
                {props.examples.map((example) => (
                  <li key={example}>
                    <button
                      type="button"
                      className={styles.example}
                      onClick={() => {
                        sendExample(example)
                      }}
                    >
                      {example}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </main>
        {panel !== undefined && (
          <div className={styles.inspector}>
            <InspectorPanel key={inspector.shown?.id} {...panel} />
          </div>
        )}
      </div>
    </div>
  )
}
