import { MAX_QUESTION_LENGTH } from '@docs-rag-lab/contracts'
import { ArrowUp, Square } from 'lucide-react'
import {
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
  type Ref,
  type SubmitEvent,
} from 'react'

import common from '../lib/common.module.css'
import styles from './Composer.module.css'
import { DocTypeSelect } from './DocTypeSelect.tsx'

/** What the page can do with the input. */
export interface ComposerHandle {
  focus: () => void
}

export interface ComposerProps {
  ref?: Ref<ComposerHandle> | undefined
  placeholder: string
  docTypes: readonly string[]
  docTypeLabels?: Readonly<Record<string, string>> | undefined
  /** The doc types to search in; empty means all of them. */
  filter: readonly string[]
  onFilterChange: (filter: string[]) => void
  /** Agentic mode (ADR-0019): Claude may search again. With no onAgenticChange, no toggle. */
  agentic?: boolean | undefined
  onAgenticChange?: ((agentic: boolean) => void) | undefined
  running: boolean
  onSend: (question: string) => void
  onStop: () => void
}

/**
 * Enter that confirms a word in an input method, and sends nothing yet. Safari ends
 * the composition before this keydown, so there only keyCode 229 tells.
 */
function isComposing(event: KeyboardEvent): boolean {
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- nothing else tells in Safari: its key is 'Enter'.
  return event.nativeEvent.isComposing || event.keyCode === 229
}

/**
 * One input with its button inside it. Enter sends and Shift+Enter adds a line.
 * Sending clears the input: the question becomes a message in the chat.
 */
export function Composer({
  ref,
  placeholder,
  docTypes,
  docTypeLabels,
  filter,
  onFilterChange,
  agentic = false,
  onAgenticChange,
  running,
  onSend,
  onStop,
}: ComposerProps) {
  const id = useId()
  const textarea = useRef<HTMLTextAreaElement>(null)
  const [question, setQuestion] = useState('')

  useImperativeHandle(ref, () => ({ focus: () => textarea.current?.focus() }), [])

  const send = () => {
    const text = question.trim()
    if (text === '') {
      textarea.current?.focus()
      return
    }
    onSend(text)
    setQuestion('')
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || isComposing(event)) return
    event.preventDefault()
    send()
  }

  return (
    <form
      className={styles.composer}
      aria-label="Ask the docs"
      onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
        event.preventDefault()
        send()
      }}
    >
      <label className={common.srOnly} htmlFor={id}>
        Question
      </label>
      <textarea
        ref={textarea}
        id={id}
        className={styles.input}
        rows={2}
        placeholder={placeholder}
        maxLength={MAX_QUESTION_LENGTH}
        value={question}
        onChange={(event) => {
          setQuestion(event.target.value)
        }}
        onKeyDown={onKeyDown}
        aria-describedby={`${id}-hint`}
      />
      <p id={`${id}-hint`} className={common.srOnly}>
        Enter sends. Shift+Enter adds a new line.
      </p>
      <div className={styles.row}>
        <div className={styles.options}>
          {docTypes.length > 0 && (
            <DocTypeSelect
              docTypes={docTypes}
              labels={docTypeLabels}
              selected={filter}
              onChange={onFilterChange}
            />
          )}
          {onAgenticChange !== undefined && (
            <label className={styles.agentic}>
              <input
                type="checkbox"
                checked={agentic}
                onKeyDown={(event) => {
                  // Enter in a form submits it, which here would send a half-written question.
                  if (event.key !== 'Enter') return
                  event.preventDefault()
                  event.currentTarget.click()
                }}
                onChange={(event) => {
                  onAgenticChange(event.target.checked)
                }}
                aria-describedby={`${id}-agentic`}
              />
              Search again
            </label>
          )}
          {onAgenticChange !== undefined && (
            <p id={`${id}-agentic`} className={common.srOnly}>
              When the first results fall short, Claude may search twice more. Slower: on the free
              tier each extra search can wait up to a minute.
            </p>
          )}
        </div>
        {/* One button that changes role, so it keeps focus when a run starts or ends. */}
        <button
          type={running ? 'button' : 'submit'}
          className={running ? styles.stop : styles.send}
          aria-label={running ? 'Stop' : 'Send'}
          onClick={(event) => {
            // The button changes role under the pointer. The second click of a double
            // click must not stop what the first sent, or send what is half written.
            if (event.detail > 1) {
              event.preventDefault()
              return
            }
            if (!running) return
            event.preventDefault()
            onStop()
          }}
        >
          {running ? <Square fill="currentColor" strokeWidth={0} /> : <ArrowUp />}
        </button>
      </div>
    </form>
  )
}
