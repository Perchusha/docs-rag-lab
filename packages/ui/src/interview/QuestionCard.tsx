import { RATINGS, type BankQuestion, type PracticeCard, type Rating } from '@docs-rag-lab/contracts'
import { ChevronRight } from 'lucide-react'
import { Fragment, useEffect, useId, useRef, useState } from 'react'

import { codeSpans } from '../lib/code-spans.ts'
import common from '../lib/common.module.css'
import { cardAction, focusOf, KIND_LABELS, RATING_LABELS } from '../lib/interview.ts'
import { ScrollRegion } from '../lib/ScrollRegion.tsx'
import styles from './Interview.module.css'

export interface QuestionCardProps {
  card: PracticeCard
  /** 1-based, of `total`. */
  index: number
  total: number
  sourceTitle: string
  /** Called once per card, with the rating the owner gave. */
  onRate: (rating: Rating) => void
  /** A rating is on its way: the buttons wait. */
  busy?: boolean | undefined
}

/** Text with its code spans as code: the bank writes them as markdown does. */
function InlineText({ text }: { text: string }) {
  return (
    <>
      {codeSpans(text).map((part, i) =>
        part.code ? <code key={i}>{part.text}</code> : <Fragment key={i}>{part.text}</Fragment>,
      )}
    </>
  )
}

function Code({ question }: { question: BankQuestion }) {
  const [setupOpen, setSetupOpen] = useState(false)
  const id = useId()
  const { code } = question
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

function Answer({ question }: { question: BankQuestion }) {
  const { compiler, citation } = question
  const section = citation.sectionPath.join(' > ')
  return (
    <>
      {question.kind === 'compiler-error' && compiler !== undefined ? (
        <>
          <p>It does not compile. TypeScript reports:</p>
          <ul className={styles.compilerErrors}>
            {compiler.errors.map((error, i) => (
              <li key={i}>
                <span className={common.badge}>{`TS${String(error.code)}`}</span> on{' '}
                <code>{error.line.trim()}</code>
                <p className={styles.compilerText}>{error.text}</p>
              </li>
            ))}
          </ul>
        </>
      ) : question.kind === 'compiler-type' && compiler !== undefined ? (
        <p>
          TypeScript shows <code>{compiler.queries[0]?.text ?? question.answer}</code>
        </p>
      ) : (
        <>
          <p>
            <InlineText text={question.answer} />
          </p>
          {question.quote !== undefined && (
            <blockquote className={styles.quote}>
              <p>
                <InlineText text={question.quote} />
              </p>
            </blockquote>
          )}
        </>
      )}
      <p className={styles.source}>
        {question.verifiedBy === 'compiler' && compiler !== undefined
          ? `Verified by the compiler: ${compiler.compiler}. `
          : 'Checked against its passage of the docs. '}
        <a className={common.link} href={citation.url} target="_blank" rel="noopener noreferrer">
          {section === '' ? citation.title : `${citation.title} > ${section}`}
        </a>
      </p>
    </>
  )
}

/**
 * One card (ADR-0018): the question and its code, an optional answer field, then the answer and
 * four ratings. The keyboard never fires while typing: in the field, Ctrl+Enter shows the
 * answer; outside it, Space shows it and 1 to 4 rate, the ratings only once it is shown.
 */
export function QuestionCard({ card, index, total, sourceTitle, onRate, busy }: QuestionCardProps) {
  const { question } = card
  const [revealed, setRevealed] = useState(false)
  const [draft, setDraft] = useState('')
  const prompt = useRef<HTMLHeadingElement>(null)
  const answerHeading = useRef<HTMLHeadingElement>(null)
  const id = useId()
  // A new card takes focus, so that it is read out and Space works at once.
  useEffect(() => {
    prompt.current?.focus()
  }, [question.id])

  useEffect(() => {
    if (revealed) answerHeading.current?.focus()
  }, [revealed])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return
      const action = cardAction(
        {
          key: event.key,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          altKey: event.altKey,
          ...focusOf(event.target),
        },
        revealed,
      )
      if (action === undefined) return
      event.preventDefault()
      if (action.type === 'reveal') setRevealed(true)
      else if (busy !== true) onRate(action.rating)
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
    }
  }, [revealed, busy, onRate])

  return (
    <article className={styles.card} aria-labelledby={`${id}-prompt`}>
      <div className={styles.cardMeta}>
        <span>{`Card ${String(index)} of ${String(total)}`}</span>
        <span>{`${sourceTitle} > ${card.topicTitle}`}</span>
        <span className={common.badge}>{KIND_LABELS[question.kind]}</span>
        {card.state === 'due' && <span className={common.badge}>Due again</span>}
      </div>
      <h2 id={`${id}-prompt`} ref={prompt} tabIndex={-1} className={styles.prompt}>
        <InlineText text={question.prompt} />
      </h2>
      <Code question={question} />
      {!revealed && (
        <>
          <label className={styles.field}>
            Your answer, if you want to write it
            <textarea
              value={draft}
              aria-describedby={`${id}-field-hint`}
              onChange={(event) => {
                setDraft(event.target.value)
              }}
            />
          </label>
          <p id={`${id}-field-hint`} className={styles.muted}>
            <kbd className={styles.kbd}>Ctrl</kbd>+<kbd className={styles.kbd}>Enter</kbd> in the
            field shows the answer.
          </p>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.primary}
              aria-describedby={`${id}-reveal-hint`}
              onClick={() => {
                setRevealed(true)
              }}
            >
              Show answer
            </button>
            <span id={`${id}-reveal-hint`} className={styles.muted}>
              or <kbd className={styles.kbd}>Space</kbd> outside the field
            </span>
          </div>
        </>
      )}
      {revealed && (
        <>
          <section className={styles.answer} aria-labelledby={`${id}-answer`}>
            <h3
              id={`${id}-answer`}
              ref={answerHeading}
              tabIndex={-1}
              className={styles.answerHeading}
            >
              Answer
            </h3>
            {draft.trim() !== '' && (
              <p className={styles.muted}>
                You wrote: <span className={styles.draft}>{draft.trim()}</span>
              </p>
            )}
            <Answer question={question} />
          </section>
          <fieldset className={styles.ratings} disabled={busy === true}>
            <legend>How well did you know it?</legend>
            <div className={styles.ratingButtons}>
              {RATINGS.map((rating, i) => (
                <button
                  key={rating}
                  type="button"
                  className={common.button}
                  aria-keyshortcuts={String(i + 1)}
                  onClick={() => {
                    onRate(rating)
                  }}
                >
                  <kbd className={styles.kbd} aria-hidden="true">
                    {String(i + 1)}
                  </kbd>{' '}
                  {RATING_LABELS[rating]}
                </button>
              ))}
            </div>
          </fieldset>
        </>
      )}
    </article>
  )
}
