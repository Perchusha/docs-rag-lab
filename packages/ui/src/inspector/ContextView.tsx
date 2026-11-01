import type { Citation, RetrievalTrace } from '@docs-rag-lab/contracts'
import { useEffect, useRef } from 'react'

import { ExternalLink } from '../chat/AnswerMarkdown.tsx'
import common from '../lib/common.module.css'
import styles from './Views.module.css'

/** A request to show one chunk: scroll to it and move focus there. A new nonce asks again. */
export interface Reveal {
  chunkId: string
  nonce: number
}

export interface ContextViewProps {
  trace: RetrievalTrace
  citations: readonly Citation[]
  selectedChunkId: string | undefined
  onSelectChunk: (chunkId: string) => void
  reveal?: Reveal | undefined
}

/** The top K chunks exactly as they went to the answer, with the ones the answer cited marked. */
export function ContextView(props: ContextViewProps) {
  const { trace, citations, selectedChunkId, onSelectChunk, reveal } = props
  const headings = useRef(new Map<string, HTMLHeadingElement>())
  const handled = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (reveal === undefined || handled.current === reveal.nonce) return
    handled.current = reveal.nonce
    const heading = headings.current.get(reveal.chunkId)
    heading?.scrollIntoView({ block: 'nearest' })
    heading?.focus()
  }, [reveal])

  if (trace.context.length === 0) {
    return <p className={styles.meta}>No chunks went to the answer.</p>
  }
  return (
    <ol
      className={styles.cards}
      aria-label={`The ${String(trace.context.length)} chunks sent to Claude`}
    >
      {trace.context.map((chunk) => {
        const cited = citations.filter((c) => c.chunkId === chunk.chunkId)
        const selected = chunk.chunkId === selectedChunkId
        return (
          <li
            key={chunk.chunkId}
            className={`${styles.card ?? ''} ${selected ? (styles.selected ?? '') : ''}`}
          >
            <div className={styles.cardHead}>
              <h3
                tabIndex={-1}
                ref={(element) => {
                  if (element === null) headings.current.delete(chunk.chunkId)
                  else headings.current.set(chunk.chunkId, element)
                }}
              >
                {chunk.rank}. {chunk.title}
              </h3>
              {cited.map((c) => (
                <span key={c.number} className={common.badge}>
                  cited as [{c.number}]
                </span>
              ))}
            </div>
            <ExternalLink href={chunk.source}>
              {chunk.source.replace(/^https?:\/\//, '')}
            </ExternalLink>
            <div>
              <button
                type="button"
                className={common.button}
                aria-pressed={selected}
                onClick={() => {
                  onSelectChunk(chunk.chunkId)
                }}
              >
                Select for the Document tab
              </button>
            </div>
            <details className={styles.details}>
              <summary>Chunk text as sent</summary>
              <pre className={styles.text}>{chunk.text}</pre>
            </details>
          </li>
        )
      })}
    </ol>
  )
}
