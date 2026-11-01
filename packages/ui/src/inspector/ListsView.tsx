import type { RetrievalTrace, TraceList } from '@docs-rag-lab/contracts'
import { useId, useState } from 'react'

import common from '../lib/common.module.css'
import { formatMs, formatScore } from '../lib/format.ts'
import { ChunkButton } from './ChunkButton.tsx'
import { LIST_DESCRIPTIONS, LIST_LABELS } from './FusionView.tsx'
import styles from './Views.module.css'

/** Candidates shown per list before "Show all". */
const LIST_ROWS = 15

export interface ListsViewProps {
  trace: RetrievalTrace
  selectedChunkId: string | undefined
  onSelectChunk: (chunkId: string) => void
}

const SCORING: Record<TraceList['scoring'], string> = {
  'cosine-distance': 'cosine distance, lower is better',
  bm25: 'BM25, higher is better',
}

function ListColumn({
  trace,
  list,
  selectedChunkId,
  onSelectChunk,
}: ListsViewProps & { list: TraceList }) {
  const id = useId()
  const [showAll, setShowAll] = useState(false)
  const candidates = showAll ? list.candidates : list.candidates.slice(0, LIST_ROWS)
  return (
    <section className={styles.list} aria-labelledby={`${id}-heading`}>
      <h3 id={`${id}-heading`}>{LIST_LABELS[list.name]}</h3>
      <p className={styles.meta}>
        {LIST_DESCRIPTIONS[list.name]}. Scores: {SCORING[list.scoring]}. {formatMs(list.ms)}.
      </p>
      {list.query !== undefined && (
        <p className={styles.meta}>
          FTS5 query: <code className={styles.query}>{list.query}</code>
        </p>
      )}
      {list.skipped !== undefined ? (
        <p className={styles.meta}>Skipped: {list.skipped}.</p>
      ) : (
        <ol className={styles.candidates} aria-label={`${LIST_LABELS[list.name]} candidates`}>
          {candidates.map((candidate) => (
            <li
              key={candidate.chunkId}
              className={candidate.chunkId === selectedChunkId ? styles.selected : undefined}
            >
              <span className={styles.rank}>
                {candidate.rank}
                <span className={common.srOnly}>.</span>
              </span>
              <ChunkButton
                chunkId={candidate.chunkId}
                chunk={trace.chunks[candidate.chunkId]}
                selected={candidate.chunkId === selectedChunkId}
                onSelect={onSelectChunk}
                className={styles.chunk}
              />
              <span className={styles.score}>
                <span className={common.srOnly}>score </span>
                {formatScore(list.scoring, candidate.score)}
              </span>
            </li>
          ))}
        </ol>
      )}
      {list.candidates.length > LIST_ROWS && (
        <button
          type="button"
          className={common.button}
          aria-expanded={showAll}
          onClick={() => {
            setShowAll((all) => !all)
          }}
        >
          {showAll
            ? `Show the top ${String(LIST_ROWS)}`
            : `Show all ${String(list.candidates.length)}`}
        </button>
      )}
    </section>
  )
}

/** The candidate lists side by side, each with its query, scores and timing, or why it was skipped. */
export function ListsView(props: ListsViewProps) {
  return (
    <div className={styles.lists}>
      {props.trace.lists.map((list) => (
        <ListColumn key={list.name} {...props} list={list} />
      ))}
    </div>
  )
}
