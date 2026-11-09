import type { MockAnswerRequest, MockGrade, MockSession, MockStep } from '@docs-rag-lab/contracts'
import { useEffect, useId, useRef, useState, type SyntheticEvent } from 'react'

import common from '../lib/common.module.css'
import { KIND_LABELS, scoreText } from '../lib/interview.ts'
import styles from './Interview.module.css'
import { InlineText, isSubmitKey, QuestionCodeBlock } from './QuestionParts.tsx'

export interface MockInterviewProps {
  session: MockSession
  /** Source titles by ID, such as TypeScript. */
  sourceTitles: Readonly<Record<string, string>>
  /** Grades one answer. It rejects with the route's error. */
  onAnswer: (request: MockAnswerRequest) => Promise<MockGrade>
  /** Every question is done, or the owner ended the interview. */
  onFinish: () => void
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/** An answer field: Ctrl+Enter in it submits, and an empty answer skips, with no call. */
function AnswerForm({
  id,
  label,
  busy,
  onSubmit,
}: {
  id: string
  label: string
  busy: boolean
  onSubmit: (answer: string) => void
}) {
  const [answer, setAnswer] = useState('')
  const submit = (event?: SyntheticEvent) => {
    event?.preventDefault()
    if (!busy) onSubmit(answer.trim())
  }
  return (
    <form className={styles.section} onSubmit={submit}>
      <label className={styles.field}>
        {label}
        <textarea
          value={answer}
          aria-describedby={`${id}-hint`}
          onChange={(event) => {
            setAnswer(event.target.value)
          }}
          onKeyDown={(event) => {
            if (isSubmitKey(event)) submit(event)
          }}
        />
      </label>
      <p id={`${id}-hint`} className={styles.muted}>
        <kbd className={styles.kbd}>Ctrl</kbd>+<kbd className={styles.kbd}>Enter</kbd> in the field
        submits it. Claude grades it against the docs, for about a cent; skipping costs nothing.
      </p>
      <div className={styles.actions}>
        <button type="submit" className={styles.primary} disabled={busy}>
          Submit answer
        </button>
        <button
          type="button"
          className={common.button}
          disabled={busy}
          onClick={() => {
            onSubmit('')
          }}
        >
          Skip
        </button>
      </div>
    </form>
  )
}

/** A grade: the score in words, the feedback with its sources, and the bank's answer. */
function GradeView({ grade, heading }: { grade: MockGrade; heading: string }) {
  const id = useId()
  const title = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    title.current?.focus()
  }, [])
  const { reference } = grade
  return (
    <section className={styles.answer} aria-labelledby={`${id}-grade`}>
      <h3 id={`${id}-grade`} ref={title} tabIndex={-1} className={styles.answerHeading}>
        {heading}
      </h3>
      <p>
        <strong>{`Score: ${scoreText(grade.score, 2)}`}</strong>
        {grade.skipped ? ', skipped' : ''}
      </p>
      {!grade.skipped && (
        <p>
          <InlineText text={grade.feedback} />
        </p>
      )}
      {grade.citations.length > 0 && (
        <>
          <h4 className={styles.subheading}>Sources</h4>
          <ol className={styles.sources}>
            {grade.citations.map((citation) => (
              <li key={citation.number} value={citation.number}>
                <a
                  className={common.link}
                  href={citation.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {citation.title}
                </a>
              </li>
            ))}
          </ol>
        </>
      )}
      {reference !== undefined && (
        <>
          <h4 className={styles.subheading}>The answer from the docs</h4>
          <p>
            <InlineText text={reference.answer} />
          </p>
          <p className={styles.source}>
            <a
              className={common.link}
              href={reference.citation.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {[reference.citation.title, ...reference.citation.sectionPath].join(' > ')}
            </a>
          </p>
        </>
      )}
    </section>
  )
}

/**
 * The mock interview (ADR-0018), a fixed loop: a question, the owner's answer, the grade with
 * citations and a score of 0 to 2, one follow-up and its grade, then the next question. Typing
 * never fires a shortcut: Ctrl+Enter in a field submits it, and nothing else listens for keys.
 */
export function MockInterview({ session, sourceTitles, onAnswer, onFinish }: MockInterviewProps) {
  const [index, setIndex] = useState(0)
  const [grades, setGrades] = useState<Partial<Record<MockStep, MockGrade>>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const prompt = useRef<HTMLHeadingElement>(null)
  const id = useId()
  const question = session.questions[index]

  useEffect(() => {
    prompt.current?.focus()
  }, [index])

  if (question === undefined) return null
  const last = index + 1 >= session.questions.length
  const first = grades.question
  const followUp = first?.followUp
  const step: MockStep | undefined =
    first === undefined
      ? 'question'
      : followUp !== undefined && grades['follow-up'] === undefined
        ? 'follow-up'
        : undefined

  const answer = async (current: MockStep, text: string) => {
    setBusy(true)
    try {
      const grade = await onAnswer({
        sessionId: session.id,
        questionId: question.id,
        step: current,
        answer: text,
      })
      setError(undefined)
      setGrades((previous) => ({ ...previous, [current]: grade }))
    } catch (failure) {
      setError(`The answer was not graded: ${messageOf(failure)}`)
    } finally {
      setBusy(false)
    }
  }

  const next = () => {
    setGrades({})
    setError(undefined)
    setIndex(index + 1)
  }

  return (
    <article className={styles.card} aria-labelledby={`${id}-prompt`}>
      <div className={styles.cardMeta}>
        <span>{`Question ${String(index + 1)} of ${String(session.questions.length)}`}</span>
        <span>{`${sourceTitles[question.source] ?? question.source} > ${question.topicTitle}`}</span>
        <span className={common.badge}>{KIND_LABELS[question.kind]}</span>
      </div>
      <h2 id={`${id}-prompt`} ref={prompt} tabIndex={-1} className={styles.prompt}>
        <InlineText text={question.prompt} />
      </h2>
      <QuestionCodeBlock key={question.id} code={question.code} />
      {step === 'question' && (
        <AnswerForm
          key={`${question.id}-question`}
          id={`${id}-question`}
          label="Your answer"
          busy={busy}
          onSubmit={(text) => {
            void answer('question', text)
          }}
        />
      )}
      {first !== undefined && <GradeView grade={first} heading="Feedback" />}
      {followUp !== undefined && (
        <section className={styles.section} aria-labelledby={`${id}-follow-up`}>
          <h3 id={`${id}-follow-up`} className={styles.answerHeading}>
            Follow-up
          </h3>
          <p className={styles.followUp}>
            <InlineText text={followUp} />
          </p>
          {step === 'follow-up' && (
            <AnswerForm
              key={`${question.id}-follow-up`}
              id={`${id}-follow-up-answer`}
              label="Your answer to the follow-up"
              busy={busy}
              onSubmit={(text) => {
                void answer('follow-up', text)
              }}
            />
          )}
        </section>
      )}
      {grades['follow-up'] !== undefined && (
        <GradeView grade={grades['follow-up']} heading="Feedback on the follow-up" />
      )}
      <p role="status" className={styles.muted}>
        {busy ? 'Grading your answer against the docs.' : ''}
      </p>
      {error !== undefined && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.actions}>
        {step === undefined &&
          (last ? (
            <button type="button" className={styles.primary} onClick={onFinish}>
              See the summary
            </button>
          ) : (
            <button type="button" className={styles.primary} onClick={next}>
              Next question
            </button>
          ))}
        {!(step === undefined && last) && (
          <button type="button" className={common.button} disabled={busy} onClick={onFinish}>
            End the interview
          </button>
        )}
      </div>
    </article>
  )
}
