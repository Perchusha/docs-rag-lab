// The retrieval inspector (SPEC section 13, M3): how the context of an answer
// was chosen. A header with the question, the query and the timings, then
// four tabs: fusion, the candidate lists, the context as sent, and the chunk
// boundaries of the selected chunk's document.
import { LIST_NAMES, type Citation, type RetrievalTrace } from '@docs-rag-lab/contracts'

import common from '../lib/common.module.css'
import { formatMs } from '../lib/format.ts'
import { doubledTokens, listOf } from '../lib/fusion.ts'
import type { Transport } from '../lib/transport.ts'
import { ContextView } from './ContextView.tsx'
import { DocumentView } from './DocumentView.tsx'
import { FusionView, LIST_LABELS } from './FusionView.tsx'
import styles from './Inspector.module.css'
import { ListsView } from './ListsView.tsx'
import { Tabs } from './Tabs.tsx'

export type InspectorTab = 'fusion' | 'lists' | 'context' | 'document'

/** The tab a new trace opens on: fusion for hybrid search, the lists for vector search. */
export function defaultTab(trace: RetrievalTrace): InspectorTab {
  return trace.fusion.method === 'rrf' ? 'fusion' : 'lists'
}

export interface InspectorProps {
  trace: RetrievalTrace | undefined
  citations: readonly Citation[]
  selectedChunkId: string | undefined
  onSelectChunk: (chunkId: string) => void
  /** undefined: the trace's default tab. */
  tab: InspectorTab | undefined
  onTabChange: (tab: InspectorTab) => void
  /** A chunk the Context tab scrolls to and focuses once; see ContextView. */
  reveal?: string | undefined
  onRevealed?: (() => void) | undefined
  transport: Transport
}

function Facts({ trace }: { trace: RetrievalTrace }) {
  const { params, query, embedding, filters } = trace
  const doubled = new Set(doubledTokens(trace))
  const timings = [
    `embed ${formatMs(embedding.ms)} (query vector from ${embedding.from === 'cache' ? 'the cache' : 'the API'})`,
    ...LIST_NAMES.flatMap((name) => {
      const list = listOf(trace, name)
      return list === undefined || list.skipped !== undefined
        ? []
        : [`${LIST_LABELS[name].toLowerCase()} ${formatMs(list.ms)}`]
    }),
    ...(trace.fusion.method === 'rrf' ? [`fuse ${formatMs(trace.fusion.ms)}`] : []),
    `total ${formatMs(trace.totalMs)}`,
  ]
  return (
    <dl className={styles.facts}>
      <dt>Question</dt>
      <dd>{trace.question}</dd>
      <dt>Strategy</dt>
      <dd>
        {trace.strategy}: {params.candidates} candidates per list
        {trace.fusion.method === 'rrf' ? `, RRF k = ${String(params.rrfK)}` : ''}, top {params.topK}{' '}
        to the answer
      </dd>
      <dt>Doc types</dt>
      <dd>{filters.docTypes.length === 0 ? 'all' : filters.docTypes.join(', ')}</dd>
      <dt>Terms</dt>
      <dd>
        {query.terms.length === 0 ? (
          'none'
        ) : (
          <ul className={styles.chips}>
            {query.terms.map((term) => (
              <li key={term} className={styles.chip}>
                {term}
              </li>
            ))}
          </ul>
        )}
      </dd>
      <dt>Exact tokens</dt>
      <dd>
        {query.exactTokens.length === 0 ? (
          'none'
        ) : (
          <ul className={styles.chips}>
            {query.exactTokens.map((exact) => (
              <li key={exact.token} className={styles.chip}>
                {exact.token} <span className={common.srOnly}>from </span>
                <span aria-hidden="true">(</span>
                {exact.from}
                <span aria-hidden="true">)</span>
                {doubled.has(exact.token) && <strong>, also a term</strong>}
              </li>
            ))}
          </ul>
        )}
      </dd>
      <dt>Timings</dt>
      <dd>{timings.join(', ')}</dd>
    </dl>
  )
}

export function Inspector(props: InspectorProps) {
  const { trace, citations, selectedChunkId, onSelectChunk, transport } = props
  if (trace === undefined) {
    return (
      <p className={styles.empty}>
        Ask a question or run a search to see how the context was chosen: every candidate list, the
        fused ranking, the chunks sent to Claude and where each chunk starts and ends.
      </p>
    )
  }
  const documentChunk = selectedChunkId ?? trace.context[0]?.chunkId
  const shared = { trace, selectedChunkId, onSelectChunk }
  return (
    <div className={styles.inspector}>
      <Facts trace={trace} />
      <Tabs<InspectorTab>
        label="Retrieval trace"
        selected={props.tab ?? defaultTab(trace)}
        onSelect={props.onTabChange}
        tabs={[
          { id: 'fusion', label: 'Fusion', panel: <FusionView {...shared} /> },
          { id: 'lists', label: 'Lists', panel: <ListsView {...shared} /> },
          {
            id: 'context',
            label: `Context (${String(trace.context.length)})`,
            panel: (
              <ContextView
                {...shared}
                citations={citations}
                reveal={props.reveal}
                onRevealed={props.onRevealed}
              />
            ),
          },
          {
            id: 'document',
            label: 'Document',
            panel:
              documentChunk === undefined ? (
                <p className={styles.note}>Select a chunk to see its document.</p>
              ) : (
                <DocumentView
                  trace={trace}
                  chunkId={documentChunk}
                  onSelectChunk={onSelectChunk}
                  transport={transport}
                />
              ),
          },
        ]}
      />
    </div>
  )
}
