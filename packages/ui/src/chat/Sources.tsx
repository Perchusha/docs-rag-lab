import type { Citation } from '@docs-rag-lab/contracts'
import { useId } from 'react'

import common from '../lib/common.module.css'
import { ExternalLink } from './AnswerMarkdown.tsx'
import styles from './Sources.module.css'

export interface SourcesProps {
  citations: readonly Citation[]
  onShow?: ((citation: Citation) => void) | undefined
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
            <blockquote className={styles.quote}>{citation.citedText}</blockquote>
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
