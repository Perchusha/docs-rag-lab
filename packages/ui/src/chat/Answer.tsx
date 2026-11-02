import { NO_CONTEXT, type Citation } from '@docs-rag-lab/contracts'
import { useId, type ReactNode } from 'react'

import { answerMarkdown } from '../lib/answer.ts'
import { isRunning, type AssistantState } from '../lib/assistant.ts'
import { AnswerMarkdown } from './AnswerMarkdown.tsx'
import styles from './Answer.module.css'
import { Sources } from './Sources.tsx'

export interface AnswerProps {
  state: AssistantState
  /** A citation asks to show its chunk; the element is where focus returns to. */
  onCitation?: ((citation: Citation, trigger: HTMLElement) => void) | undefined
  /** Goes under the answer, above its sources. */
  actions?: ReactNode
}

function note(state: AssistantState): string | undefined {
  if (state.phase === 'stopped') return 'Stopped.'
  if (state.phase !== 'done') return undefined
  if (state.stopReason === NO_CONTEXT) return 'No indexed chunks to answer from.'
  if (state.stopReason === 'max_tokens') return 'The answer hit the length limit and is cut off.'
  if (state.stopReason === 'refusal') return 'Claude declined to answer.'
  return undefined
}

/**
 * One exchange: the question as the user's message, then the streamed answer and
 * its sources. The question is a heading, so a screen reader can jump between
 * questions. The answer is deliberately not a live region: a screen reader would
 * read every delta. The status line announces the state instead.
 */
export function Answer({ state, onCitation, actions }: AnswerProps) {
  const id = useId()
  const streaming = isRunning(state)
  const markdown = answerMarkdown(state.parts)
  const message = note(state)
  return (
    <article className={styles.answer} aria-labelledby={`${id}-question`} aria-busy={streaming}>
      <h2 id={`${id}-question`} className={styles.question}>
        {state.question}
      </h2>
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
      {actions !== undefined && <div>{actions}</div>}
      <Sources citations={state.citations} onShow={onCitation} />
    </article>
  )
}
