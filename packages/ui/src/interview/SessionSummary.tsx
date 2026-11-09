import type { MockSummary } from '@docs-rag-lab/contracts'
import { useEffect, useRef } from 'react'

import common from '../lib/common.module.css'
import { mockSummaryText, scoreText } from '../lib/interview.ts'
import styles from './Interview.module.css'
import { InlineText } from './QuestionParts.tsx'

export interface SessionSummaryProps {
  summary: MockSummary
  /** Source titles by ID, such as TypeScript. */
  sourceTitles: Readonly<Record<string, string>>
  busy: boolean
  onAgain: () => void
  onHome: () => void
}

/**
 * The end of a mock interview (ADR-0018): each question's score in words, the weak topics,
 * weakest first, and up to three sections of the docs to read. Its heading takes focus.
 */
export function SessionSummary({
  summary,
  sourceTitles,
  busy,
  onAgain,
  onHome,
}: SessionSummaryProps) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    heading.current?.focus()
  }, [])
  const title = (source: string): string => sourceTitles[source] ?? source
  const allRight = summary.questions.length > 0 && summary.weakTopics.length === 0

  return (
    <section className={styles.section} aria-labelledby="drl-mock-done-heading">
      <h2 id="drl-mock-done-heading" ref={heading} tabIndex={-1}>
        Mock interview done
      </h2>
      <p>{mockSummaryText(summary)}</p>
      {summary.questions.length > 0 && (
        <>
          <h3 className={styles.answerHeading}>Questions</h3>
          <ul className={styles.results}>
            {summary.questions.map((result) => (
              <li key={result.questionId}>
                <span className={styles.muted}>
                  {`${title(result.source)} > ${result.topicTitle}`}
                </span>
                <span>
                  <InlineText text={result.prompt} />
                </span>
                <span className={common.badge}>{scoreText(result.score, result.max)}</span>
              </li>
            ))}
          </ul>
          <h3 className={styles.answerHeading}>Weak topics</h3>
          {allRight ? (
            <p>None: every answer scored 2 of 2.</p>
          ) : (
            <ul className={styles.results}>
              {summary.weakTopics.map((topic) => (
                <li key={`${topic.source}:${topic.topicId}`}>
                  <span>{`${title(topic.source)} > ${topic.title}`}</span>
                  <span className={common.badge}>{scoreText(topic.score, topic.max)}</span>
                </li>
              ))}
            </ul>
          )}
          <h3 className={styles.answerHeading}>Read next</h3>
          {summary.read.length === 0 ? (
            <p>Nothing to read: every answer scored 2 of 2.</p>
          ) : (
            <ol className={styles.sources}>
              {summary.read.map((section) => (
                <li key={section.url}>
                  <a
                    className={common.link}
                    href={section.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {section.title}
                  </a>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
      <div className={styles.actions}>
        <button type="button" className={styles.primary} disabled={busy} onClick={onAgain}>
          Another mock interview
        </button>
        <button type="button" className={common.button} onClick={onHome}>
          Back to topics
        </button>
      </div>
    </section>
  )
}
