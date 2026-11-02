import type { Citation } from '@docs-rag-lab/contracts'
import { useId, useMemo, useState } from 'react'

import common from '../lib/common.module.css'
import { excerptPreview } from '../lib/excerpt.ts'
import { AnswerMarkdown, ExternalLink } from './AnswerMarkdown.tsx'
import styles from './Sources.module.css'

export interface SourcesProps {
  citations: readonly Citation[]
  onShow?: ((citation: Citation, trigger: HTMLElement) => void) | undefined
}

/** A cited passage, rendered as markdown like the answer. A long one starts collapsed. */
function Excerpt({ text, source }: { text: string; source: number }) {
  const [open, setOpen] = useState(false)
  const preview = useMemo(() => excerptPreview(text), [text])
  return (
    <div className={styles.excerpt}>
      <AnswerMarkdown markdown={open || preview === undefined ? text : preview} quoted />
      {preview !== undefined && (
        <button
          type="button"
          className={styles.more}
          aria-expanded={open}
          onClick={() => {
            setOpen((value) => !value)
          }}
        >
          {open ? 'Show less' : 'Show more'}
          <span className={common.srOnly}>: source {source}</span>
        </button>
      )}
    </div>
  )
}

/** The answer's sources, numbered like its markers, with the passages Claude cited. */
export function Sources({ citations, onShow }: SourcesProps) {
  const id = useId()
  if (citations.length === 0) return null
  return (
    <div className={styles.sources}>
      <h3 id={`${id}-heading`} className={styles.heading}>
        Sources
      </h3>
      <ol className={styles.list} aria-labelledby={`${id}-heading`}>
        {citations.map((citation) => (
          <li key={citation.number} className={styles.item} value={citation.number}>
            <div className={styles.title}>
              <ExternalLink href={citation.source}>{citation.title}</ExternalLink>
            </div>
            <Excerpt text={citation.citedText} source={citation.number} />
            {onShow !== undefined && (
              <button
                type="button"
                className={styles.show}
                onClick={(event) => {
                  onShow(citation, event.currentTarget)
                }}
              >
                Show in the inspector
                <span className={common.srOnly}>: source {citation.number}</span>
              </button>
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}
