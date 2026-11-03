'use client'

// The eval dashboard (SPEC section 3, ADR-0013). Its first screen answers three questions, with
// the uncertainty beside every number, and the rest stays behind one disclosure. It only reads:
// it has nothing that could spend anything.
import { useId, useMemo, useRef, useState } from 'react'

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
  /** A run the address asked for and the store does not have. */
  missingRun?: string | undefined
  /** Reports that could not be read, and so are not in `runs`. */
  unreadableRuns?: readonly string[] | undefined
  /** For stories: replays data instead of fetching it. */
  transport?: EvalTransport | undefined
}

export function EvalDashboard({
  title,
  runs,
  initial,
  endpoints,
  missingRun,
  unreadableRuns = [],
  transport,
}: EvalDashboardProps) {
  const pickerId = useId()
  const client = useMemo(() => transport ?? evalFetchTransport(endpoints), [transport, endpoints])
  const [run, setRun] = useState(initial)
  const [selected, setSelected] = useState(initial?.id)
  const [status, setStatus] = useState('')
  const [error, setError] = useState<string>()
  const [open, setOpen] = useState(false)
  const [missing, setMissing] = useState(missingRun)
  const latest = useRef(0)

  const choose = (id: string) => {
    // A slower answer to an earlier choice must not replace what the picker now says.
    latest.current += 1
    const request = latest.current
    setSelected(id)
    setMissing(undefined)
    setError(undefined)
    setStatus('Loading the run.')
    client
      .run(id)
      .then((value) => {
        if (request !== latest.current) return
        setRun(value)
        setStatus(`Showing the run ${value.name}.`)
        window.history.replaceState(null, '', `?run=${encodeURIComponent(id)}`)
      })
      .catch((reason: unknown) => {
        if (request !== latest.current) return
        setStatus('')
        setSelected(run?.id)
        setError(reason instanceof Error ? reason.message : String(reason))
      })
  }

  const notices = (
    <>
      {missing !== undefined && (
        <p role="alert">
          There is no run "{missing}"{run === undefined ? '' : `, so this shows ${run.name}`}.
        </p>
      )}
      {unreadableRuns.length > 0 && (
        <p role="alert">Could not read these reports: {unreadableRuns.join(', ')}.</p>
      )}
    </>
  )

  if (run === undefined) {
    return (
      <div className={styles.root}>
        <main className={styles.page}>
          <h1 className={styles.title}>{title}</h1>
          {notices}
          {unreadableRuns.length === 0 && (
            <p>There is no named run yet: make one with drl eval --name.</p>
          )}
        </main>
      </div>
    )
  }
  return (
    <div className={styles.root}>
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
        {notices}
        {error !== undefined && <p role="alert">That run did not load: {error}</p>}
        <SectionTable section={run.retrieval} />
        {run.answers !== null && <SectionTable section={run.answers} />}
        <TrustSection
          trust={run.trust}
          after={
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
          }
        />
        {open && <DetailsPanel key={run.id} runId={run.id} runs={runs} transport={client} />}
      </main>
    </div>
  )
}
