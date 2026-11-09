import {
  MAX_FLAG_REASON,
  RATINGS,
  type BankQuestion,
  type PracticeCard,
  type QuestionPassage,
  type Rating,
} from '@docs-rag-lab/contracts'
import { useEffect, useId, useRef, useState, type SyntheticEvent } from 'react'

import { AnswerMarkdown } from '../chat/AnswerMarkdown.tsx'
import common from '../lib/common.module.css'
import { cardAction, focusOf, KIND_LABELS, RATING_LABELS } from '../lib/interview.ts'
import styles from './Interview.module.css'
import { InlineText, isSubmitKey, QuestionCodeBlock } from './QuestionParts.tsx'

export interface QuestionCardProps {
  card: PracticeCard
  /** 1-based, of `total`. */
  index: number
  total: number
  sourceTitle: string
  /** Called once per card, with the rating the owner gave. */
  onRate: (rating: Rating) => void
  /**
   * The owner found the answer wrong, and says why (ADR-0018): the card is hidden for them. With
   * none, the card offers no flag.
   */
  onFlag?: ((reason: string) => void) | undefined
  /** A rating or a flag is on its way: the buttons wait. */
  busy?: boolean | undefined
}

/**
 * The section of the docs a generated answer was checked against, the one its link opens
 * (ADR-0018): the block its quote is in is marked by a rule and a label, never by colour alone.
 * Relative links lead to the docs.
 */
function Passage({ passage, pageUrl }: { passage: QuestionPassage; pageUrl: string }) {
  const id = useId()
  return (
    <section className={styles.passage} aria-labelledby={`${id}-passage`}>
      <h4 id={`${id}-passage`} className={styles.subheading}>
        From the docs
      </h4>
      {passage.blocks.map((block, i) =>
        block.quote ? (
          <div key={i} className={styles.quoted}>
            <p className={styles.quotedLabel}>The quote</p>
            <AnswerMarkdown markdown={block.text} quoted baseUrl={pageUrl} />
          </div>
        ) : (
          <AnswerMarkdown key={i} markdown={block.text} quoted baseUrl={pageUrl} />
        ),
      )}
    </section>
  )
}

function Answer({
  question,
  passage,
}: {
  question: BankQuestion
  passage: QuestionPassage | undefined
}) {
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
          {passage !== undefined ? (
            <Passage passage={passage} pageUrl={citation.url} />
          ) : (
            question.quote !== undefined && (
              <blockquote className={styles.quote}>
                <p>
                  <InlineText text={question.quote} />
                </p>
              </blockquote>
            )
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
 * "This answer is wrong", once the answer is shown (ADR-0018): the owner says why, and the card
 * is hidden for them. The reason stays on this computer, where `drl questions flagged` lists it.
 * In the field Ctrl+Enter hides the card, and no other shortcut fires while it is open.
 */
function FlagForm({
  id,
  busy,
  onFlag,
  onCancel,
}: {
  id: string
  busy: boolean
  onFlag: (reason: string) => void
  onCancel: () => void
}) {
  const [reason, setReason] = useState('')
  const [missing, setMissing] = useState(false)
  const field = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    field.current?.focus()
  }, [])

  const submit = (event?: SyntheticEvent) => {
    event?.preventDefault()
    if (busy) return
    if (reason.trim() === '') {
      setMissing(true)
      field.current?.focus()
      return
    }
    onFlag(reason.trim())
  }

  return (
    <form className={styles.flag} aria-labelledby={`${id}-flag`} noValidate onSubmit={submit}>
      <h3 id={`${id}-flag`} className={styles.answerHeading}>
        This answer is wrong
      </h3>
      <label className={styles.field}>
        What is wrong with it?
        <textarea
          ref={field}
          value={reason}
          maxLength={MAX_FLAG_REASON}
          aria-invalid={missing}
          aria-describedby={missing ? `${id}-flag-missing ${id}-flag-hint` : `${id}-flag-hint`}
          onChange={(event) => {
            setReason(event.target.value)
            if (event.target.value.trim() !== '') setMissing(false)
          }}
          onKeyDown={(event) => {
            if (isSubmitKey(event)) submit(event)
            else if (event.key === 'Escape') {
              event.preventDefault()
              onCancel()
            }
          }}
        />
      </label>
      {missing && (
        <p id={`${id}-flag-missing`} className={styles.fieldError}>
          Say what is wrong, so that it can be checked against the docs.
        </p>
      )}
      <p id={`${id}-flag-hint`} className={styles.muted}>
        The card is hidden for you, and the reason stays on this computer, where{' '}
        <code>drl questions flagged</code> lists it. <kbd className={styles.kbd}>Ctrl</kbd>+
        <kbd className={styles.kbd}>Enter</kbd> in the field hides it, and{' '}
        <kbd className={styles.kbd}>Escape</kbd> cancels.
      </p>
      <div className={styles.actions}>
        <button type="submit" className={styles.primary} disabled={busy}>
          Hide this card
        </button>
        <button type="button" className={common.button} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}

/**
 * One card (ADR-0018): the question and its code, an optional answer field, then the answer and
 * four ratings. The keyboard never fires while typing: in the field, Ctrl+Enter shows the
 * answer; outside it, Space shows it and 1 to 4 rate, the ratings only once it is shown.
 */
export function QuestionCard({
  card,
  index,
  total,
  sourceTitle,
  onRate,
  onFlag,
  busy,
}: QuestionCardProps) {
  const { question } = card
  const [revealed, setRevealed] = useState(false)
  const [draft, setDraft] = useState('')
  const [flagging, setFlagging] = useState(false)
  const prompt = useRef<HTMLHeadingElement>(null)
  const answerHeading = useRef<HTMLHeadingElement>(null)
  const flagButton = useRef<HTMLButtonElement>(null)
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
      if (event.defaultPrevented || event.repeat || flagging) return
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
  }, [revealed, busy, onRate, flagging])

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
      <QuestionCodeBlock code={question.code} />
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
            <Answer question={question} passage={card.passage} />
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
          {onFlag !== undefined &&
            (flagging ? (
              <FlagForm
                id={id}
                busy={busy === true}
                onFlag={onFlag}
                onCancel={() => {
                  setFlagging(false)
                  // The button comes back on the next render, and takes focus there.
                  requestAnimationFrame(() => flagButton.current?.focus())
                }}
              />
            ) : (
              <button
                ref={flagButton}
                type="button"
                className={styles.disclosure}
                onClick={() => {
                  setFlagging(true)
                }}
              >
                This answer is wrong
              </button>
            ))}
        </>
      )}
    </article>
  )
}
