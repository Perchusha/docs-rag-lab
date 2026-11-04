// Can these numbers be trusted? The judge's calibration and known bias, the set, the docs, and
// whether a re-run reproduced the report (ADR-0013).
import { useId, useState } from 'react'

import type { DashboardAgreement, DashboardRound, DashboardTrust } from '@docs-rag-lab/contracts'

import {
  calibratedWords,
  dimensionWords,
  percentRange,
  spotCheckIntro,
  staleWords,
} from '../lib/eval.ts'
import { ScrollRegion } from '../lib/ScrollRegion.tsx'
import styles from './EvalDashboard.module.css'

const agreementWords = ({ dimension, agreed, compared, low, high }: DashboardAgreement): string =>
  `${dimensionWords[dimension]} ${String(agreed)} of ${String(compared)} (${percentRange(low, high)})`

function Rounds({ rounds }: { rounds: readonly DashboardRound[] }) {
  return (
    <ScrollRegion label="Calibration rounds" focusOnlyWhenOverflowing>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Round</th>
            <th scope="col">Measured</th>
            <th scope="col">Agreed</th>
            <th scope="col">Cohen's kappa</th>
            <th scope="col">Reached the bar</th>
          </tr>
        </thead>
        <tbody>
          {rounds.flatMap((round, index) =>
            round.agreement.map((result) => (
              <tr key={`${String(index)}-${result.dimension}`}>
                <th scope="row" className={styles.rowLabel}>
                  {round.name}
                  {!round.blind && <span className={styles.exploratory}> Not blind</span>}
                </th>
                <td>{dimensionWords[result.dimension]}</td>
                <td className={styles.figure}>
                  {`${String(result.agreed)} of ${String(result.compared)} (${percentRange(result.low, result.high)})`}
                </td>
                <td className={styles.figure}>
                  {result.kappa === null ? '-' : result.kappa.toFixed(2)}
                </td>
                <td>{round.blind ? (result.passed ? 'yes' : 'no') : 'decides nothing'}</td>
              </tr>
            )),
          )}
        </tbody>
      </table>
    </ScrollRegion>
  )
}

export function TrustSection({ trust }: { trust: DashboardTrust }) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const { judge, goldenSet, docs, indexDocsSha, stale, review, verify, index, spotCheck } = trust
  const missing =
    judge === null
      ? []
      : (['correctness', 'refusal', 'support'] as const).filter(
          (dimension) => !judge.agreement.some((result) => result.dimension === dimension),
        )
  const indexWords =
    indexDocsSha === null
      ? 'no index could be read to compare with'
      : indexDocsSha === docs.sha
        ? 'the index is at the same commit'
        : `the index is now at ${indexDocsSha.slice(0, 8)}, so this describes other docs`
  return (
    <section aria-labelledby={id} className={styles.section}>
      <h2 id={id} className={styles.question}>
        Can these numbers be trusted?
      </h2>
      <dl className={styles.trust}>
        <dt>Judge</dt>
        <dd>
          {judge === null ? (
            'This run has no answers, so no judge graded it.'
          ) : (
            <>
              <strong>{calibratedWords(judge)}</strong>{' '}
              {[
                ...judge.agreement.map(agreementWords),
                ...missing.map((dimension) => `${dimensionWords[dimension]} not labelled`),
              ].join(', ')}
              {judge.unreadable.length > 0 && ` Could not read ${judge.unreadable.join(', ')}.`}
            </>
          )}
        </dd>
        {judge?.bias != null && (
          <>
            <dt>Known bias</dt>
            <dd>{judge.bias}</dd>
          </>
        )}
        {spotCheck !== undefined && (
          <>
            <dt>Spot check</dt>
            <dd>
              <strong>
                {spotCheck.passed ? 'Passed on these answers.' : 'Missed on these answers.'}
              </strong>{' '}
              {spotCheckIntro(spotCheck)} {spotCheck.agreement.map(agreementWords).join(', ')}.
              {spotCheck.bias !== null && ` ${spotCheck.bias}`}
            </dd>
          </>
        )}
        <dt>Set and docs</dt>
        <dd>
          Golden set v{String(goldenSet.version)} ({goldenSet.hash.slice(0, 12)}), docs{' '}
          {docs.sha.slice(0, 8)}: {indexWords}. {staleWords(stale.length, review.length)}.
        </dd>
        <dt>Verify</dt>
        <dd>{verify === null ? 'Not checked.' : verify.text}</dd>
        {index !== undefined && (
          <>
            <dt>Index</dt>
            <dd>{index}</dd>
          </>
        )}
      </dl>
      {judge !== null && judge.rounds.length > 0 && (
        <>
          <button
            type="button"
            className={styles.disclosure}
            aria-expanded={open}
            onClick={() => {
              setOpen(!open)
            }}
          >
            How this was calibrated
          </button>
          {open && <Rounds rounds={judge.rounds} />}
        </>
      )}
    </section>
  )
}
