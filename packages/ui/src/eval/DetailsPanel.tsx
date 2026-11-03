// Everything behind the first screen (ADR-0013): tags, questions, the cited chunks and the
// runs. Its data loads when it opens, so the first screen stays small.
import { useEffect, useId, useState } from 'react'

import type {
  DashboardDetails,
  DashboardRunComparison,
  DashboardRunEntry,
} from '@docs-rag-lab/contracts'

import { Tabs } from '../inspector/Tabs.tsx'
import type { EvalTransport } from '../lib/eval-transport.ts'
import { ScrollRegion } from '../lib/ScrollRegion.tsx'
import styles from './EvalDashboard.module.css'
import { SectionTable } from './SectionTable.tsx'

type TabId = 'tags' | 'questions' | 'chunks' | 'runs'

function QuestionsTab({ details }: { details: DashboardDetails }) {
  const [showAll, setShowAll] = useState(false)
  const differing = details.questions.filter(({ differs }) => differs)
  const shown = showAll ? details.questions : differing
  const columns = {
    ranks: details.questions[0]?.ranks.map(({ column }) => column) ?? [],
    answers: details.questions[0]?.answers.map(({ column }) => column) ?? [],
  }
  return (
    <>
      <p className={styles.summary}>
        {showAll
          ? `All ${String(details.questions.length)} questions.`
          : `The ${String(differing.length)} questions where strategies or rows differ.`}
      </p>
      <button
        type="button"
        className={styles.disclosure}
        aria-pressed={showAll}
        onClick={() => {
          setShowAll(!showAll)
        }}
      >
        Show all {String(details.questions.length)} questions
      </button>
      <ScrollRegion label="Per question" focusOnlyWhenOverflowing>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Question</th>
              {columns.ranks.map((column) => (
                <th key={`rank-${column}`} scope="col">
                  {column}: rank of the right chunk
                </th>
              ))}
              {columns.answers.map((column) => (
                <th key={`grade-${column}`} scope="col">
                  {column}: answer
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((question) => (
              <tr key={question.id}>
                <th scope="row" className={styles.rowLabel}>
                  {question.question}{' '}
                  <span className={styles.note}>
                    {question.id}, {question.tags.join(', ')}
                  </span>
                </th>
                {question.ranks.map(({ column, rank }) => (
                  <td key={column} className={styles.figure}>
                    {rank === null ? '-' : String(rank)}
                  </td>
                ))}
                {question.answers.map(({ column, grade }) => (
                  <td key={column}>{grade}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollRegion>
    </>
  )
}

function ChunksTab({ details }: { details: DashboardDetails }) {
  return (
    <>
      <p className={styles.summary}>
        The judge found that these cited chunks support a correct answer, and they are not anchors.
        None is added automatically: they wait for the review of golden set v2.
      </p>
      <ScrollRegion label="Cited chunks" focusOnlyWhenOverflowing>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Question</th>
              <th scope="col">Cited by</th>
              <th scope="col">Document</th>
              <th scope="col">Chunk</th>
            </tr>
          </thead>
          <tbody>
            {details.candidates.map((candidate) => (
              <tr key={`${candidate.questionId}-${candidate.chunkId}`}>
                <th scope="row" className={styles.rowLabel}>
                  {candidate.questionId}
                </th>
                <td>{candidate.column}</td>
                <td>{candidate.docPath}</td>
                <td className={styles.figure}>{candidate.chunkId.slice(0, 12)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollRegion>
    </>
  )
}

function RunsTab({
  runs,
  current,
  transport,
}: {
  runs: readonly DashboardRunEntry[]
  current: string
  transport: EvalTransport
}) {
  const firstId = useId()
  const secondId = useId()
  const other = runs.find(({ id }) => id !== current)?.id ?? current
  const [a, setA] = useState(other)
  const [b, setB] = useState(current)
  const [result, setResult] = useState<DashboardRunComparison>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  const compare = () => {
    setBusy(true)
    setError(undefined)
    transport
      .compare(a, b)
      .then(setResult)
      .catch((reason: unknown) => {
        setResult(undefined)
        setError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => {
        setBusy(false)
      })
  }

  const options = runs.map(({ id, name, sha }) => (
    <option key={id} value={id}>
      {name} ({sha})
    </option>
  ))
  return (
    <>
      <ScrollRegion label="Named runs" focusOnlyWhenOverflowing>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Run</th>
              <th scope="col">Measured</th>
              <th scope="col">Commit</th>
              <th scope="col">Answers</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id}>
                <th scope="row" className={styles.rowLabel}>
                  {run.name}
                </th>
                <td>{run.createdAt.slice(0, 10)}</td>
                <td className={styles.figure}>{run.sha}</td>
                <td>{run.hasAnswers ? 'yes' : 'no'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollRegion>
      <div className={styles.compareForm}>
        <label htmlFor={firstId}>Compare</label>
        <select
          id={firstId}
          value={a}
          onChange={(event) => {
            setA(event.target.value)
          }}
        >
          {options}
        </select>
        <label htmlFor={secondId}>with</label>
        <select
          id={secondId}
          value={b}
          onChange={(event) => {
            setB(event.target.value)
          }}
        >
          {options}
        </select>
        <button type="button" className={styles.disclosure} disabled={busy} onClick={compare}>
          Compare
        </button>
      </div>
      {error !== undefined && <p role="alert">{error}</p>}
      {result?.comparable === false && <p role="alert">{result.reason}</p>}
      {result?.comparable === true && (
        <>
          {result.differences.length > 0 && (
            <>
              <p className={styles.summary}>What else differs:</p>
              <ul className={styles.differences}>
                {result.differences.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </>
          )}
          <SectionTable section={result.section} level={3} />
          {result.moved.length > 0 && (
            <ScrollRegion label="Ranks that moved" focusOnlyWhenOverflowing>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Question</th>
                    <th scope="col">Strategy</th>
                    <th scope="col">{result.a}</th>
                    <th scope="col">{result.b}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.moved.map((move) => (
                    <tr key={`${move.strategy}-${move.questionId}`}>
                      <th scope="row" className={styles.rowLabel}>
                        {move.questionId}
                      </th>
                      <td>{move.strategy}</td>
                      <td className={styles.figure}>{move.from ?? '-'}</td>
                      <td className={styles.figure}>{move.to ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
          )}
        </>
      )}
    </>
  )
}

export function DetailsPanel({
  runId,
  runs,
  transport,
}: {
  runId: string
  runs: readonly DashboardRunEntry[]
  transport: EvalTransport
}) {
  const [details, setDetails] = useState<DashboardDetails>()
  const [error, setError] = useState<string>()
  const [tab, setTab] = useState<TabId>('tags')

  useEffect(() => {
    let current = true
    transport
      .details(runId)
      .then((value) => {
        if (current) setDetails(value)
      })
      .catch((reason: unknown) => {
        if (current) setError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => {
      current = false
    }
  }, [runId, transport])

  if (error !== undefined) return <p role="alert">The details did not load: {error}</p>
  if (details === undefined) return <p role="status">Loading the details.</p>
  return (
    <Tabs
      label="Details"
      selected={tab}
      onSelect={setTab}
      tabs={[
        {
          id: 'tags',
          label: 'Per tag',
          panel: details.tags.map((section) => (
            <SectionTable key={section.question} section={section} level={3} />
          )),
        },
        { id: 'questions', label: 'Per question', panel: <QuestionsTab details={details} /> },
        {
          id: 'chunks',
          label: `Cited chunks (${String(details.candidates.length)})`,
          panel: <ChunksTab details={details} />,
        },
        {
          id: 'runs',
          label: 'Runs',
          panel: <RunsTab runs={runs} current={runId} transport={transport} />,
        },
      ]}
    />
  )
}
