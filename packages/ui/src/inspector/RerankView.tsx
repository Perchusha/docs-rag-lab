// What the reranker would change on this search, on demand (ADR-0014). The chat stays on hybrid, so
// this is a comparison and never a method: it changes neither the answer nor the next question.
import type { Citation, RetrievalTrace } from '@docs-rag-lab/contracts'
import { Fragment } from 'react'

import common from '../lib/common.module.css'
import { formatMs } from '../lib/format.ts'
import { rerankRows, rerankSource, rerankSummary } from '../lib/rerank.ts'
import { ScrollRegion } from '../lib/ScrollRegion.tsx'
import { ChunkButton } from './ChunkButton.tsx'
import styles from './Inspector.module.css'

export interface RerankComparison {
  /** The rerank trace of this search, once there is one. */
  trace: RetrievalTrace | undefined
  running: boolean
  error: string | undefined
  onCompare: () => void
  /** Stops waiting. A call already sent still reaches the cache. */
  onStop: () => void
}

export interface RerankViewProps {
  /** The trace the panel shows, which is what gets compared. */
  trace: RetrievalTrace
  comparison: RerankComparison
  /** Whether an answer came from this search. */
  answered: boolean
  citations?: readonly Citation[] | undefined
  selectedChunkId: string | undefined
  onSelectChunk: (chunkId: string) => void
}

function statusOf({ running, error }: RerankComparison): string {
  if (running) return 'Reranking, with no Claude call. On the free trial this can take a minute.'
  return error === undefined ? '' : `Error: ${error.replace(/\.$/, '')}.`
}

export function RerankView(props: RerankViewProps) {
  const { trace, comparison, answered, citations, selectedChunkId, onSelectChunk } = props
  if (trace.fusion.method !== 'rrf') {
    return (
      <p className={styles.note}>
        The reranker reads the hybrid ranking, so compare from a hybrid search.
      </p>
    )
  }
  const reranked = comparison.trace
  const rows = reranked === undefined ? [] : rerankRows(reranked)
  const status = statusOf(comparison)
  return (
    <div>
      {reranked === undefined && (
        <p className={styles.note}>
          <strong>What the reranker would change.</strong> One Voyage call on the free trial, up to
          about a minute, with no Claude call. It changes neither this answer nor your next
          question.
        </p>
      )}
      {/* Always there: a region that appears with its first message may go unannounced. */}
      <p role="status" className={status === '' ? common.srOnly : styles.note}>
        {status}
      </p>
      {comparison.running ? (
        <button type="button" className={common.button} onClick={comparison.onStop}>
          Stop waiting
        </button>
      ) : (
        reranked === undefined && (
          <button type="button" className={common.button} onClick={comparison.onCompare}>
            Compare with rerank
          </button>
        )
      )}
      {reranked !== undefined && (
        <>
          <p className={styles.note}>
            {rerankSummary(rows, reranked.params.topK)}
            {answered && ' The answer above stays as it is.'}
          </p>
          <ScrollRegion label="What the reranker would change">
            <table className={styles.table}>
              <caption className={common.srOnly}>What the reranker would change</caption>
              <thead>
                <tr>
                  <th scope="col" className={styles.num}>
                    Now
                  </th>
                  <th scope="col" className={styles.num}>
                    Was
                  </th>
                  <th scope="col" className={styles.num}>
                    Score
                  </th>
                  <th scope="col">Chunk</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <Fragment key={row.chunkId}>
                    <tr className={row.chunkId === selectedChunkId ? styles.selected : undefined}>
                      <td className={styles.num}>{row.rank}</td>
                      <td className={styles.num}>{row.was}</td>
                      <td className={styles.num}>{row.score.toFixed(3)}</td>
                      <td>
                        <ChunkButton
                          chunkId={row.chunkId}
                          chunk={reranked.chunks[row.chunkId]}
                          selected={row.chunkId === selectedChunkId}
                          source={citations?.find((c) => c.chunkId === row.chunkId)?.number}
                          onSelect={onSelectChunk}
                          className={styles.chunk}
                          titleClassName={styles.chunkTitle}
                          locationClassName={styles.location}
                        />
                        {row.change !== undefined && (
                          <span className={common.badge}>{row.change}</span>
                        )}
                      </td>
                    </tr>
                    {row.rank === reranked.params.topK && rows.length > row.rank && (
                      <tr className={styles.divider}>
                        <td colSpan={4}>The top {reranked.params.topK} go to an answer</td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
          <p className={styles.note}>
            {rerankSource(reranked, formatMs(reranked.rerank?.ms ?? 0))}
          </p>
        </>
      )}
    </div>
  )
}
