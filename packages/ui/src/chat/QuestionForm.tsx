import { MAX_QUESTION_LENGTH, type RetrievalRequest, type Strategy } from '@docs-rag-lab/contracts'
import { useId, useRef, useState, type KeyboardEvent, type SubmitEvent } from 'react'

import type { Mode } from '../lib/assistant.ts'
import common from '../lib/common.module.css'
import styles from './QuestionForm.module.css'

export type QuestionRequest = Omit<RetrievalRequest, 'source'>

export interface QuestionFormProps {
  examples: readonly string[]
  /** The source's doc types, for the filter. */
  docTypes: readonly string[]
  defaultStrategy: Strategy
  running: boolean
  onSubmit: (mode: Mode, request: QuestionRequest) => void
  onStop: () => void
}

const STRATEGY_LABELS: Record<Strategy, string> = {
  hybrid: 'Hybrid: vector and BM25, fused by RRF',
  vector: 'Vector only',
}

export function QuestionForm(props: QuestionFormProps) {
  const { examples, docTypes, running, onSubmit, onStop } = props
  const id = useId()
  const textarea = useRef<HTMLTextAreaElement>(null)
  const [question, setQuestion] = useState('')
  const [strategy, setStrategy] = useState<Strategy>(props.defaultStrategy)
  const [filter, setFilter] = useState<string[]>([])

  const submit = (mode: Mode) => {
    if (question.trim() === '') {
      textarea.current?.focus()
      return
    }
    onSubmit(mode, { question: question.trim(), strategy, docTypes: filter })
  }

  const onFormSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    submit('ask')
  }

  // Enter adds a line; Ctrl+Enter (Cmd+Enter on a Mac) asks.
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      submit('ask')
    }
  }

  const toggleDocType = (docType: string, checked: boolean) => {
    setFilter((current) =>
      checked
        ? docTypes.filter((d) => d === docType || current.includes(d))
        : current.filter((d) => d !== docType),
    )
  }

  return (
    <form className={styles.form} onSubmit={onFormSubmit} aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`} className={common.srOnly}>
        Ask the docs
      </h2>
      <label className={styles.label} htmlFor={`${id}-question`}>
        Question
      </label>
      <textarea
        ref={textarea}
        id={`${id}-question`}
        className={styles.question}
        rows={3}
        maxLength={MAX_QUESTION_LENGTH}
        value={question}
        onChange={(event) => {
          setQuestion(event.target.value)
        }}
        onKeyDown={onKeyDown}
        aria-describedby={`${id}-hint`}
      />
      <p id={`${id}-hint`} className={styles.hint}>
        Ctrl+Enter asks. Search only shows the retrieval without calling Claude.
      </p>

      {examples.length > 0 && (
        <div className={styles.examples}>
          <span id={`${id}-examples`} className={styles.hint}>
            Examples
          </span>
          <ul aria-labelledby={`${id}-examples`}>
            {examples.map((example) => (
              <li key={example}>
                <button
                  type="button"
                  className={styles.example}
                  onClick={() => {
                    setQuestion(example)
                    textarea.current?.focus()
                  }}
                >
                  {example}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className={styles.options}>
        <fieldset className={styles.fieldset}>
          <legend>Retrieval</legend>
          {(Object.keys(STRATEGY_LABELS) as Strategy[]).map((value) => (
            <label key={value} className={styles.choice}>
              <input
                type="radio"
                name={`${id}-strategy`}
                value={value}
                checked={strategy === value}
                onChange={() => {
                  setStrategy(value)
                }}
              />
              {STRATEGY_LABELS[value]}
            </label>
          ))}
        </fieldset>
        {docTypes.length > 0 && (
          <fieldset className={styles.fieldset}>
            <legend>Doc types (none checked searches all)</legend>
            {docTypes.map((docType) => (
              <label key={docType} className={styles.choice}>
                <input
                  type="checkbox"
                  checked={filter.includes(docType)}
                  onChange={(event) => {
                    toggleDocType(docType, event.target.checked)
                  }}
                />
                {docType}
              </label>
            ))}
          </fieldset>
        )}
      </div>

      <div className={styles.actions}>
        <button type="submit" className={common.primary}>
          Ask
        </button>
        <button
          type="button"
          className={common.button}
          onClick={() => {
            submit('search')
          }}
        >
          Search only
        </button>
        {/* aria-disabled, not disabled: the button keeps focus when the run ends. */}
        <button
          type="button"
          className={common.button}
          aria-disabled={!running}
          onClick={() => {
            if (running) onStop()
          }}
        >
          Stop
        </button>
      </div>
    </form>
  )
}
