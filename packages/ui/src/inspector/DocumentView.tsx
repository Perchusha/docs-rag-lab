import type { DocumentChunks, RetrievalTrace } from '@docs-rag-lab/contracts'
import { useEffect, useState } from 'react'

import { ExternalLink } from '../chat/AnswerMarkdown.tsx'
import common from '../lib/common.module.css'
import type { Transport } from '../lib/transport.ts'
import styles from './Views.module.css'

export interface DocumentViewProps {
  trace: RetrievalTrace
  /** The chunk whose document to show. */
  chunkId: string
  onSelectChunk: (chunkId: string) => void
  transport: Transport
}

type Loaded = { path: string; document: DocumentChunks } | { path: string; error: string }

/**
 * The chunk boundaries of one document, in order: where each chunk starts and
 * ends, its section, anchor and size, and which ones retrieval found.
 */
export function DocumentView({ trace, chunkId, onSelectChunk, transport }: DocumentViewProps) {
  const docPath = trace.chunks[chunkId]?.docPath
  const [loaded, setLoaded] = useState<Loaded | undefined>(undefined)

  useEffect(() => {
    if (docPath === undefined) return
    const controller = new AbortController()
    transport.document(trace.sourceId, docPath, controller.signal).then(
      (document) => {
        setLoaded({ path: docPath, document })
      },
      (error: unknown) => {
        if (controller.signal.aborted) return
        setLoaded({ path: docPath, error: error instanceof Error ? error.message : String(error) })
      },
    )
    return () => {
      controller.abort()
    }
  }, [transport, trace.sourceId, docPath])

  if (docPath === undefined) {
    return <p className={styles.meta}>This chunk is not in the trace.</p>
  }
  if (loaded?.path !== docPath) return <p className={styles.meta}>Loading the document</p>
  if ('error' in loaded) {
    return <p className={styles.error}>Could not load the document: {loaded.error}</p>
  }

  const { document } = loaded
  const fused = new Map(
    trace.fusion.method === 'rrf'
      ? trace.fusion.ranked.map((entry) => [entry.chunkId, entry.rank])
      : (trace.lists[0]?.candidates.map((c) => [c.chunkId, c.rank]) ?? []),
  )
  const context = new Map(trace.context.map((c) => [c.chunkId, c.rank]))

  return (
    <div className={styles.document}>
      <h3>
        {document.title} <span className={common.badge}>{document.docType}</span>
      </h3>
      <p className={styles.meta}>
        {document.chunks.length} chunks, in document order.{' '}
        <ExternalLink href={document.url}>Open the page</ExternalLink>
      </p>
      <ol className={styles.cards} aria-label={`Chunks of ${document.title}`}>
        {document.chunks.map((chunk) => {
          const selected = chunk.chunkId === chunkId
          const rank = fused.get(chunk.chunkId)
          const contextRank = context.get(chunk.chunkId)
          const classes = [
            styles.card,
            rank !== undefined ? styles.candidate : undefined,
            selected ? styles.selected : undefined,
          ]
          return (
            <li key={chunk.chunkId} className={classes.filter(Boolean).join(' ')}>
              <div className={styles.cardHead}>
                <span className={styles.rank}>#{chunk.ordinal}</span>
                <button
                  type="button"
                  className={styles.chunk}
                  aria-current={selected ? 'true' : undefined}
                  onClick={() => {
                    onSelectChunk(chunk.chunkId)
                  }}
                >
                  {chunk.sectionPath.length > 0 ? chunk.sectionPath.join(' > ') : document.title}
                </button>
                {selected && <span className={common.badge}>selected</span>}
                {rank !== undefined && <span className={common.badge}>candidate #{rank}</span>}
                {contextRank !== undefined && (
                  <span className={common.badge}>in context #{contextRank}</span>
                )}
              </div>
              <p className={styles.meta}>
                #{chunk.anchor === '' ? '(no anchor)' : chunk.anchor}, {chunk.tokenCount} tokens,{' '}
                {chunk.spans.length} {chunk.spans.length === 1 ? 'block' : 'blocks'}
              </p>
              {selected ? (
                <pre className={styles.text}>{chunk.text}</pre>
              ) : (
                <details className={styles.details}>
                  <summary>Chunk text</summary>
                  <pre className={styles.text}>{chunk.text}</pre>
                </details>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
