import type { Citation } from '@docs-rag-lab/contracts'
import { useId, useState } from 'react'

import common from '../lib/common.module.css'
import { excerptPreview } from '../lib/excerpt.ts'
import { AnswerMarkdown, ExternalLink } from './AnswerMarkdown.tsx'
import styles from './Sources.module.css'

export interface SourcesProps {
  citations: readonly Citation[]
  onShow?: ((citation: Citation) => void) | undefined
}

/** A cited passage, rendered as markdown like the answer. A long one starts collapsed. */
function Excerpt({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const preview = excerptPreview(text)
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
    <section className={styles.sources} aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`} className={styles.heading}>
        Sources
      </h2>
      <ol className={styles.list}>
        {citations.map((citation) => (
          <li key={citation.number} className={styles.item} value={citation.number}>
            <div className={styles.title}>
              <ExternalLink href={citation.source}>{citation.title}</ExternalLink>
            </div>
            <Excerpt text={citation.citedText} />
            {onShow !== undefined && (
              <button
                type="button"
                className={common.button}
                onClick={() => {
                  onShow(citation)
                }}
              >
                Show chunk {citation.contextRank} in the inspector
              </button>
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}
