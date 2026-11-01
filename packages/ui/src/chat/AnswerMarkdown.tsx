// Claude's answer is markdown. It is rendered safely (ADR-0008):
// - no raw HTML: there is no rehype-raw, so HTML in the answer shows as text;
// - react-markdown's default URL sanitizing stays, so javascript: and other
//   unsafe URLs are dropped;
// - only http(s) links render as links, opening in a new tab with
//   rel="noopener noreferrer"; images render as their alt text, so an answer
//   cannot load anything from elsewhere.
// Citation markers arrive as links to #cite-<n> (lib/answer.ts) and become
// buttons that show the cited chunk in the inspector.
import type { Citation } from '@docs-rag-lab/contracts'
import { useMemo, type ReactNode } from 'react'
import Markdown, { type Components } from 'react-markdown'

import { citationNumber } from '../lib/answer.ts'
import common from '../lib/common.module.css'
import styles from './AnswerMarkdown.module.css'

export interface AnswerMarkdownProps {
  markdown: string
  citations: readonly Citation[]
  onCitation?: ((citation: Citation) => void) | undefined
}

function isWebUrl(href: string | undefined): href is string {
  return href !== undefined && /^https?:\/\//i.test(href)
}

export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className={common.link} href={href} target="_blank" rel="noopener noreferrer">
      {children}
      <span className={common.srOnly}> (opens in a new tab)</span>
    </a>
  )
}

export function AnswerMarkdown({ markdown, citations, onCitation }: AnswerMarkdownProps) {
  const components = useMemo<Components>(
    () => ({
      a: ({ href, children }) => {
        const n = citationNumber(href)
        if (n !== undefined) {
          const citation = citations.find((c) => c.number === n)
          if (citation === undefined) return <span className={styles.marker}>[{n}]</span>
          return (
            <button
              type="button"
              className={styles.citation}
              aria-label={`Source ${String(n)}: ${citation.title}. Show it in the inspector`}
              title={citation.title}
              onClick={() => onCitation?.(citation)}
            >
              {n}
            </button>
          )
        }
        return isWebUrl(href) ? <ExternalLink href={href}>{children}</ExternalLink> : children
      },
      img: ({ alt }) => (alt === undefined || alt === '' ? null : <span>{alt}</span>),
    }),
    [citations, onCitation],
  )
  return (
    <div className={styles.markdown}>
      <Markdown components={components}>{markdown}</Markdown>
    </div>
  )
}
