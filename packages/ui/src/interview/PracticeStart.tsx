import type { PracticeSummary } from '@docs-rag-lab/contracts'

import { isFirstRun, summaryText } from '../lib/interview.ts'
import styles from './Interview.module.css'

export interface PracticeStartProps {
  /** Undefined while the overview loads. */
  summary: PracticeSummary | undefined
  /** The chosen technologies, by name, for the words of the first run. */
  sourceTitles: readonly string[]
  busy: boolean
  onQuick: () => void
}

const listOf = (names: readonly string[]): string =>
  names.length <= 1
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`

/**
 * The main way in: Quick 10, ten cards due or new across the chosen technologies (ADR-0018). On
 * the first run nothing is due, so it says what Quick 10 will do instead of "0 due".
 */
export function PracticeStart({ summary, sourceTitles, busy, onQuick }: PracticeStartProps) {
  const empty = summary?.questions === 0
  return (
    <section className={styles.section} aria-labelledby="drl-start-heading">
      <h2 id="drl-start-heading">Practice</h2>
      {summary === undefined ? (
        <p className={styles.muted}>Loading your progress.</p>
      ) : empty ? (
        <p className={styles.muted}>
          The bank has no questions for {listOf(sourceTitles)} yet. They are written by drl
          questions.
        </p>
      ) : isFirstRun(summary) ? (
        <p>
          Nothing to review yet. Quick 10 picks ten new questions across {listOf(sourceTitles)}.
          Answer each one, show the answer and rate how well you knew it: each card then comes back
          when it is due.
        </p>
      ) : (
        <p>{summaryText(summary)}</p>
      )}
      <button
        type="button"
        className={styles.primary}
        disabled={busy || summary === undefined || empty}
        onClick={onQuick}
      >
        Quick 10
      </button>
    </section>
  )
}
