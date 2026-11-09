// What a practice card and the mock interview show alike (ADR-0018): text with its code spans, and
// a question's code from the docs with the setup the site hides one click away.
import type { QuestionCode } from '@docs-rag-lab/contracts'
import { ChevronRight } from 'lucide-react'
import { Fragment, useId, useState, type KeyboardEvent } from 'react'

import { codeSpans } from '../lib/code-spans.ts'
import { ScrollRegion } from '../lib/ScrollRegion.tsx'
import styles from './Interview.module.css'

/** Text with its code spans as code: the bank writes them as markdown does. */
export function InlineText({ text }: { text: string }) {
  return (
    <>
      {codeSpans(text).map((part, i) =>
        part.code ? <code key={i}>{part.text}</code> : <Fragment key={i}>{part.text}</Fragment>,
      )}
    </>
  )
}

/** The code shown with a question, as the site shows it, and its hidden setup on demand. */
export function QuestionCodeBlock({ code }: { code: QuestionCode | undefined }) {
  const [setupOpen, setSetupOpen] = useState(false)
  const id = useId()
  if (code === undefined) return null
  return (
    <>
      {code.setup !== undefined && (
        <>
          <button
            type="button"
            className={styles.disclosure}
            aria-expanded={setupOpen}
            aria-controls={setupOpen ? `${id}-setup` : undefined}
            onClick={() => {
              setSetupOpen(!setupOpen)
            }}
          >
            <ChevronRight className={styles.chevron} aria-hidden="true" />
            Setup (hidden on the site)
          </button>
          {setupOpen && (
            <div id={`${id}-setup`}>
              <ScrollRegion label="Setup code" focusOnlyWhenOverflowing>
                <pre className={styles.code}>
                  <code>{code.setup}</code>
                </pre>
              </ScrollRegion>
            </div>
          )}
        </>
      )}
      <ScrollRegion label="Code" focusOnlyWhenOverflowing>
        <pre className={styles.code}>
          <code>{code.code}</code>
        </pre>
      </ScrollRegion>
    </>
  )
}

/** Ctrl+Enter, or Cmd+Enter, in a text field: the field's own submit. */
export const isSubmitKey = (event: KeyboardEvent<HTMLTextAreaElement>): boolean =>
  event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.altKey
