import { NO_CONTEXT, type Citation } from '@docs-rag-lab/contracts'
import { useId } from 'react'

import { answerMarkdown } from '../lib/answer.ts'
import { isRunning, type AssistantState } from '../lib/assistant.ts'
import { formatUsage } from '../lib/format.ts'
import { AnswerMarkdown } from './AnswerMarkdown.tsx'
import styles from './Answer.module.css'

export interface AnswerProps {
  state: AssistantState
  onCitation?: ((citation: Citation) => void) | undefined
}

function note(state: AssistantState): string | undefined {
  if (state.phase === 'stopped') return 'Stopped.'
  if (state.phase !== 'done' || state.mode !== 'ask') return undefined
  if (state.stopReason === NO_CONTEXT) return 'No indexed chunks to answer from.'
  if (state.stopReason === 'max_tokens') return 'The answer hit the length limit and is cut off.'
  if (state.stopReason === 'refusal') return 'Claude declined to answer.'
  return undefined
}

/**
 * The streamed answer. It is deliberately not a live region: a screen reader
 * would read every delta. The status line announces the state instead.
 */
export function Answer({ state, onCitation }: AnswerProps) {
  const id = useId()
  if (state.phase === 'idle') return null
  const streaming = isRunning(state)
  const markdown = answerMarkdown(state.parts)
  const message = note(state)
  return (
    <article className={styles.answer} aria-labelledby={`${id}-heading`} aria-busy={streaming}>
      <h2 id={`${id}-heading`} className={styles.heading}>
        {state.mode === 'search' ? 'Search' : 'Answer'}
      </h2>
      <p className={styles.question}>{state.question}</p>
      {state.mode === 'search' && state.phase === 'done' && (
        <p className={styles.note}>
          Search only: no answer was generated. The inspector shows the retrieval.
        </p>
      )}
      {markdown !== '' && (
        <AnswerMarkdown markdown={markdown} citations={state.citations} onCitation={onCitation} />
      )}
      {streaming && (
        <p className={styles.progress} aria-hidden="true">
          <span className={styles.dot} />
          <span className={styles.dot} />
          <span className={styles.dot} />
        </p>
      )}
      {message !== undefined && <p className={styles.note}>{message}</p>}
      {state.phase === 'failed' && (
        <p className={styles.error}>
          <strong>Error:</strong> {state.error}
        </p>
      )}
      {state.usage !== undefined && <p className={styles.usage}>{formatUsage(state.usage)}</p>}
    </article>
  )
}
