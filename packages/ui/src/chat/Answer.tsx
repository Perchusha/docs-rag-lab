import { NO_CONTEXT, type Citation } from '@docs-rag-lab/contracts'
import { useId, useMemo, type ReactNode } from 'react'

import { answerMarkdown } from '../lib/answer.ts'
import {
  foundText,
  isRunning,
  waitingText,
  type AgentStep,
  type AssistantState,
  type Phase,
} from '../lib/assistant.ts'
import { AnswerMarkdown } from './AnswerMarkdown.tsx'
import styles from './Answer.module.css'
import { labelOf } from './DocTypeSelect.tsx'
import { Sources } from './Sources.tsx'

export interface AnswerProps {
  state: AssistantState
  /** A citation asks to show its chunk; the element is where focus returns to. */
  onCitation?: ((citation: Citation, trigger: HTMLElement) => void) | undefined
  /** Goes under the answer, above its sources. */
  actions?: ReactNode
  /** Plain-language names for the doc types a search of Claude's own keeps to. */
  docTypeLabels?: Readonly<Record<string, string>> | undefined
}

interface StepProps {
  step: AgentStep
  phase: Phase
  labels: AnswerProps['docTypeLabels']
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
 * One search of Claude's own: what it searched for, then what it brought back or why it waits.
 * One cut short by Stop or a failure says so, rather than wait on.
 */
function Step({ step, phase, labels }: StepProps) {
  const finished = step.status === 'done'
  const running = !finished && (phase === 'searching' || phase === 'answering')
  const where =
    step.docTypes.length === 0
      ? ''
      : ` in ${step.docTypes.map((docType) => labelOf(docType, labels)).join(', ')}`
  let result: string | undefined
  if (finished) result = foundText(step)
  else if (!running) result = phase === 'stopped' ? 'stopped' : 'did not finish'
  else if (step.waitMs !== undefined) result = waitingText(step.waitMs)
  return (
    <li className={running ? styles.stepRunning : styles.step}>
      {finished ? 'Searched again for ' : 'Searching again for '}
      <q className={styles.query}>{step.query}</q>
      {where}
      {result === undefined ? '' : `: ${result}`}
    </li>
  )
}

/**
 * One exchange: the question as the user's message, then the streamed answer and
 * its sources. The question is a heading, so a screen reader can jump between
 * questions. The answer is deliberately not a live region: a screen reader would
 * read every delta. The status line announces the state instead.
 */
export function Answer({ state, onCitation, actions, docTypeLabels }: AnswerProps) {
  const id = useId()
  const streaming = isRunning(state)
  const markdown = useMemo(() => answerMarkdown(state.parts), [state.parts])
  const message = note(state)
  return (
    <article className={styles.answer} aria-labelledby={`${id}-question`} aria-busy={streaming}>
      <h2 id={`${id}-question`} className={styles.question}>
        {state.question}
      </h2>
      {/* What a slow step is waiting for, as it waits: Voyage's free tier allows 3 a minute. */}
      {state.phase === 'searching' && state.waitMs !== undefined && (
        <p className={styles.note}>{waitingText(state.waitMs)}</p>
      )}
      {state.steps.length > 0 && (
        // list-style: none drops the list from Safari's accessibility tree without the role.
        <ol role="list" className={styles.steps} aria-label="Searches of Claude's own">
          {state.steps.map((step, i) => (
            <Step key={i} step={step} phase={state.phase} labels={docTypeLabels} />
          ))}
        </ol>
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
      {actions !== undefined && <div>{actions}</div>}
      <Sources citations={state.citations} onShow={onCitation} />
    </article>
  )
}
