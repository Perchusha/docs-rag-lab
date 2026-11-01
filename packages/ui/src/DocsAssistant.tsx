'use client'
// A docs assistant: ask on the left, see how the answer's context was chosen on
// the right (SPEC section 13, M3). An app renders this from a server component
// with its config: serializable props only, so the transport is built here
// from the endpoints unless a story or test passes its own.
import type { Citation, RetrievalRequest, Strategy } from '@docs-rag-lab/contracts'
import { useCallback, useId, useMemo, useState, type CSSProperties } from 'react'

import { Answer } from './chat/Answer.tsx'
import { QuestionForm, type QuestionRequest } from './chat/QuestionForm.tsx'
import { Sources } from './chat/Sources.tsx'
import { useAssistant } from './chat/useAssistant.ts'
import styles from './DocsAssistant.module.css'
import type { Reveal } from './inspector/ContextView.tsx'
import { Inspector, type InspectorTab } from './inspector/Inspector.tsx'
import { isRunning, statusText, type Mode } from './lib/assistant.ts'
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
  /** The source's doc types, for the filter. */
  docTypes: readonly string[]
  defaultStrategy: Strategy
  theme?: Theme | undefined
  endpoints: Endpoints
  /** Replaces fetch over the endpoints, for stories and tests. */
  transport?: Transport | undefined
}

export function DocsAssistant(props: DocsAssistantProps) {
  const { title, sourceId, endpoints, theme } = props
  const id = useId()
  const transport = useMemo(
    () => props.transport ?? fetchTransport(endpoints),
    [props.transport, endpoints],
  )
  const { state, run, stop } = useAssistant(transport)
  const [selected, setSelected] = useState<string | undefined>(undefined)
  const [tab, setTab] = useState<InspectorTab | undefined>(undefined)
  const [reveal, setReveal] = useState<Reveal | undefined>(undefined)

  const submit = useCallback(
    (mode: Mode, request: QuestionRequest) => {
      setSelected(undefined)
      setTab(undefined)
      setReveal(undefined)
      const full: RetrievalRequest =
        sourceId === undefined ? request : { ...request, source: sourceId }
      void run(mode, full)
    },
    [run, sourceId],
  )

  // A citation shows its chunk: selected, in the Context tab, with focus on it.
  const showCitation = useCallback((citation: Citation) => {
    setSelected(citation.chunkId)
    setTab('context')
    setReveal((current) => ({ chunkId: citation.chunkId, nonce: (current?.nonce ?? 0) + 1 }))
  }, [])

  const style =
    theme === undefined
      ? undefined
      : ({
          '--accent-light': theme.accent.light,
          '--accent-dark': theme.accent.dark,
        } as CSSProperties)

  return (
    <div className={styles.root} data-drl-theme="" style={style}>
      <header className={styles.header}>
        <h1>{title}</h1>
        {props.tagline !== undefined && <p className={styles.tagline}>{props.tagline}</p>}
      </header>
      <main className={styles.columns}>
        <div className={styles.chat}>
          <QuestionForm
            examples={props.examples}
            docTypes={props.docTypes}
            defaultStrategy={props.defaultStrategy}
            running={isRunning(state)}
            onSubmit={submit}
            onStop={stop}
          />
          <p role="status" className={styles.status}>
            {statusText(state)}
          </p>
          <Answer state={state} onCitation={showCitation} />
          <Sources citations={state.citations} onShow={showCitation} />
        </div>
        <section className={styles.inspector} aria-labelledby={`${id}-inspector`}>
          <h2 id={`${id}-inspector`}>Retrieval inspector</h2>
          <Inspector
            trace={state.trace}
            citations={state.citations}
            selectedChunkId={selected}
            onSelectChunk={setSelected}
            tab={tab}
            onTabChange={setTab}
            reveal={reveal}
            transport={transport}
          />
        </section>
      </main>
    </div>
  )
}
