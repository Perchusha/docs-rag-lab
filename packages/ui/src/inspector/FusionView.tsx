// The fusion view (ADR-0005, ADR-0008): every fused candidate with its rank and
// score in each list, its RRF score and what each list added to it, so BM25
// counting twice is visible. Double counting is never shown by colour alone:
// the row also says "BM25 x2". The table is a real table, and its sortable
// headers are buttons inside headers that carry aria-sort.
import { LIST_NAMES, type ListName, type RetrievalTrace } from '@docs-rag-lab/contracts'
import { Fragment, useMemo, useState } from 'react'

import common from '../lib/common.module.css'
import { formatRrf, formatScore } from '../lib/format.ts'
import {
  doubleCounting,
  fusionRows,
  listOf,
  maxRrfScore,
  sortRows,
  type DoubleCounting,
  type FusionRow,
  type SortDirection,
  type SortKey,
} from '../lib/fusion.ts'
import { ChunkButton } from './ChunkButton.tsx'
import styles from './Inspector.module.css'

/** Rows shown before "Show all". */
export const FUSION_ROWS = 20

export const LIST_LABELS: Record<ListName, string> = {
  vector: 'Vector',
  keyword: 'Keyword',
  exact: 'Exact',
}

export const LIST_DESCRIPTIONS: Record<ListName, string> = {
  vector: 'vector search, cosine distance',
  keyword: 'BM25 over the search terms',
  exact: 'BM25 over the exact tokens',
}

export interface FusionViewProps {
  trace: RetrievalTrace
  selectedChunkId: string | undefined
  onSelectChunk: (chunkId: string) => void
}

function Banner({ counting }: { counting: DoubleCounting }) {
  const { tokens, inContext, topK } = counting
  const named =
    tokens.length === 0
      ? 'These chunks are in both the keyword and the exact list'
      : `${tokens.map((t) => `"${t}"`).join(', ')} ${tokens.length === 1 ? 'is' : 'are'} both a search term and an exact token`
  return (
    <p className={styles.banner}>
      <strong>BM25 counts twice.</strong> {named}, so BM25 adds to the RRF score twice for{' '}
      {inContext} of the top {topK} chunks: once from each list. Those rows say BM25 x2.
    </p>
  )
}

function Delta({ delta }: { delta: FusionRow['delta'] }) {
  if (delta === 'new') {
    return (
      <span className={styles.new}>
        new<span className={common.srOnly}>: not in the vector list</span>
      </span>
    )
  }
  if (delta === 0) {
    return (
      <span className={styles.same}>
        <span aria-hidden="true">=</span>
        <span className={common.srOnly}>same as vector</span>
      </span>
    )
  }
  const up = delta > 0
  return (
    <span className={up ? styles.up : styles.down}>
      <span aria-hidden="true">
        {up ? '▲' : '▼'} {Math.abs(delta)}
      </span>
      <span className={common.srOnly}>
        {up ? 'up' : 'down'} {Math.abs(delta)} from vector
      </span>
    </span>
  )
}

function RankCell({ row, name, trace }: { row: FusionRow; name: ListName; trace: RetrievalTrace }) {
  const cell = row.cells[name]
  if (cell === undefined) {
    return (
      <td className={styles.num}>
        <span aria-hidden="true">-</span>
        <span className={common.srOnly}>not in this list</span>
      </td>
    )
  }
  const scoring = listOf(trace, name)?.scoring ?? 'bm25'
  return (
    <td className={styles.num}>
      <span className={styles.rank}>{cell.rank}</span>
      <span className={styles.score}>
        <span className={common.srOnly}>, score </span>
        {formatScore(scoring, cell.score)}
      </span>
    </td>
  )
}

function Contributions({ row, max }: { row: FusionRow; max: number }) {
  const parts = LIST_NAMES.flatMap((name) => {
    const cell = row.cells[name]
    return cell === undefined ? [] : [{ name, contribution: cell.contribution }]
  })
  const label = parts.map((p) => `${p.name} ${formatRrf(p.contribution)}`).join(', ')
  return (
    <div className={styles.bar} role="img" aria-label={label}>
      {parts.map((p) => (
        <span
          key={p.name}
          className={styles[p.name]}
          style={{ width: `${String((p.contribution / max) * 100)}%` }}
        />
      ))}
    </div>
  )
}

function SortHeader(props: {
  sortKey: SortKey
  label: string
  description: string
  sort: { key: SortKey; direction: SortDirection }
  onSort: (key: SortKey) => void
}) {
  const { sortKey, label, sort, onSort } = props
  const active = sort.key === sortKey
  return (
    <th scope="col" aria-sort={active ? sort.direction : undefined} className={styles.num}>
      <button
        type="button"
        className={styles.sort}
        title={`Sort by ${props.description}`}
        onClick={() => {
          onSort(sortKey)
        }}
      >
        {label}
        <span aria-hidden="true">
          {active ? (sort.direction === 'ascending' ? ' ▲' : ' ▼') : ''}
        </span>
      </button>
    </th>
  )
}

export function FusionView({ trace, selectedChunkId, onSelectChunk }: FusionViewProps) {
  const rows = useMemo(() => fusionRows(trace), [trace])
  const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection }>({
    key: 'fused',
    direction: 'ascending',
  })
  const [showAll, setShowAll] = useState(false)

  if (trace.fusion.method !== 'rrf') {
    return (
      <p className={styles.note}>
        This search used vector search only, so nothing was fused. The Lists tab shows the vector
        ranking.
      </p>
    )
  }

  const onSort = (key: SortKey) => {
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === 'ascending' ? 'descending' : 'ascending' }
        : { key, direction: 'ascending' },
    )
  }
  const sorted = sortRows(rows, sort.key, sort.direction)
  const visible = showAll ? sorted : sorted.slice(0, FUSION_ROWS)
  const counting = doubleCounting(trace, rows)
  const max = maxRrfScore(trace)
  const { topK } = trace.params
  const fusedOrder = sort.key === 'fused' && sort.direction === 'ascending'

  return (
    <div>
      {counting !== undefined && <Banner counting={counting} />}
      <ul className={styles.legend} aria-label="Lists">
        {LIST_NAMES.map((name) => (
          <li key={name}>
            <span className={`${styles.swatch ?? ''} ${styles[name] ?? ''}`} aria-hidden="true" />
            {LIST_LABELS[name]}: {LIST_DESCRIPTIONS[name]}
          </li>
        ))}
      </ul>
      <div className={styles.scroll}>
        <table className={styles.table}>
          <caption>
            The fused ranking (RRF, k = {trace.fusion.k}): each chunk&apos;s rank and score in every
            list, and what each list adds to its RRF score.
          </caption>
          <thead>
            <tr>
              <SortHeader
                sortKey="fused"
                label="Fused"
                description="fused rank"
                sort={sort}
                onSort={onSort}
              />
              <th scope="col">Δ vs vector</th>
              <th scope="col">Chunk</th>
              {LIST_NAMES.map((name) => (
                <SortHeader
                  key={name}
                  sortKey={name}
                  label={LIST_LABELS[name]}
                  description={`rank in ${LIST_DESCRIPTIONS[name]}`}
                  sort={sort}
                  onSort={onSort}
                />
              ))}
              <th scope="col" className={styles.num}>
                RRF score
              </th>
              <th scope="col">Contributions</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <Fragment key={row.chunkId}>
                <tr className={row.chunkId === selectedChunkId ? styles.selected : undefined}>
                  <td className={styles.num}>{row.fusedRank}</td>
                  <td>
                    <Delta delta={row.delta} />
                  </td>
                  <td>
                    <ChunkButton
                      chunkId={row.chunkId}
                      chunk={row.chunk}
                      selected={row.chunkId === selectedChunkId}
                      onSelect={onSelectChunk}
                      className={styles.chunk}
                      titleClassName={styles.chunkTitle}
                      locationClassName={styles.location}
                    />
                    {row.bm25Twice && (
                      <span
                        className={`${common.badge ?? ''} ${styles.twice ?? ''}`}
                        title="In both BM25 lists: BM25 adds to its score twice"
                      >
                        BM25 x2
                      </span>
                    )}
                  </td>
                  {LIST_NAMES.map((name) => (
                    <RankCell key={name} row={row} name={name} trace={trace} />
                  ))}
                  <td className={styles.num}>{formatRrf(row.rrfScore)}</td>
                  <td>
                    <Contributions row={row} max={max} />
                  </td>
                </tr>
                {fusedOrder && row.fusedRank === topK && rows.length > topK && (
                  <tr className={styles.divider}>
                    <td colSpan={8}>The top {topK} go to the answer</td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > FUSION_ROWS && (
        <button
          type="button"
          className={`${common.button ?? ''} ${styles.more ?? ''}`}
          aria-expanded={showAll}
          onClick={() => {
            setShowAll((all) => !all)
          }}
        >
          {showAll ? `Show the top ${String(FUSION_ROWS)}` : `Show all ${String(rows.length)}`}
        </button>
      )}
    </div>
  )
}
