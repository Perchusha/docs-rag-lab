'use client'

// The eval dashboard (SPEC section 3, ADR-0013). Its first screen answers three questions, with
// the uncertainty beside every number, and the rest stays behind one disclosure. It only reads:
// it has nothing that could spend anything.
import { useId, useMemo, useState } from 'react'

import type { DashboardRun, DashboardRunEntry } from '@docs-rag-lab/contracts'

import {
  evalFetchTransport,
  type EvalEndpoints,
  type EvalTransport,
} from '../lib/eval-transport.ts'
import { DetailsPanel } from './DetailsPanel.tsx'
import styles from './EvalDashboard.module.css'
import { SectionTable } from './SectionTable.tsx'
import { TrustSection } from './TrustSection.tsx'

export interface EvalDashboardProps {
  title: string
  runs: readonly DashboardRunEntry[]
  /** The run to show first, or undefined when there is none yet. */
  initial: DashboardRun | undefined
  endpoints: EvalEndpoints
  /** For stories: replays data instead of fetching it. */
  transport?: EvalTransport | undefined
}

export function EvalDashboard({ title, runs, initial, endpoints, transport }: EvalDashboardProps) {
  const pickerId = useId()
  const client = useMemo(() => transport ?? evalFetchTransport(endpoints), [transport, endpoints])
  const [run, setRun] = useState(initial)
  const [selected, setSelected] = useState(initial?.id)
  const [status, setStatus] = useState('')
  const [error, setError] = useState<string>()
  const [open, setOpen] = useState(false)

  const choose = (id: string) => {
    setSelected(id)
    setError(undefined)
    setStatus('Loading the run.')
    client
      .run(id)
      .then((value) => {
        setRun(value)
        setStatus(`Showing the run ${value.name}.`)
        window.history.replaceState(null, '', `?run=${encodeURIComponent(id)}`)
      })
      .catch((reason: unknown) => {
        setStatus('')
        setSelected(run?.id)
        setError(reason instanceof Error ? reason.message : String(reason))
      })
  }

  if (run === undefined) {
    return (
      <main className={styles.page}>
        <h1 className={styles.title}>{title}</h1>
        <p>There is no named run yet: make one with drl eval --name.</p>
      </main>
    )
  }
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{title}</h1>
        <div className={styles.picker}>
          <label htmlFor={pickerId}>Run</label>
          <select
            id={pickerId}
            value={selected}
            onChange={(event) => {
              choose(event.target.value)
            }}
          >
            {runs.map(({ id, name, createdAt, sha }) => (
              <option key={id} value={id}>
                {name}, {createdAt.slice(0, 10)}, {sha}
              </option>
            ))}
          </select>
        </div>
      </header>
      <p role="status" className={styles.srOnly}>
        {status}
      </p>
      {error !== undefined && <p role="alert">That run did not load: {error}</p>}
      <SectionTable section={run.retrieval} />
      {run.answers !== null && <SectionTable section={run.answers} />}
      <TrustSection trust={run.trust} />
      <button
        type="button"
        className={styles.disclosure}
        aria-expanded={open}
        onClick={() => {
          setOpen(!open)
        }}
      >
        Details: per tag, per question, cited chunks, runs
      </button>
      {open && <DetailsPanel key={run.id} runId={run.id} runs={runs} transport={client} />}
    </main>
  )
}
