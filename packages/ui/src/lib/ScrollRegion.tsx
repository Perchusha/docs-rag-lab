import type { ReactNode } from 'react'

import styles from './ScrollRegion.module.css'

export interface ScrollRegionProps {
  /** What the box holds, for screen readers: a focusable box needs a name. */
  label: string
  className?: string | undefined
  children: ReactNode
}

/**
 * A box for wide content, a table or a code block, that scrolls sideways so the
 * page does not (ADR-0008). It takes focus, so the arrow keys can scroll it: a
 * keyboard cannot otherwise reach what is off to the side. It is a group and
 * not a region, so several in one answer do not each add a landmark.
 */
export function ScrollRegion({ label, className, children }: ScrollRegionProps) {
  return (
    <div
      role="group"
      aria-label={label}
      tabIndex={0}
      className={[styles.region, className].filter(Boolean).join(' ')}
    >
      {children}
    </div>
  )
}
