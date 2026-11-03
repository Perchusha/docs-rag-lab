import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import styles from './ScrollRegion.module.css'

export interface ScrollRegionProps {
  /** What the box holds, for screen readers: a focusable box needs a name. */
  label: string
  className?: string | undefined
  /**
   * Take focus only while the content really is wider than the box, so a table that fits
   * adds no tab stop. A keyboard still reaches whatever is off to the side.
   */
  focusOnlyWhenOverflowing?: boolean | undefined
  children: ReactNode
}

/**
 * A box for wide content, a table or a code block, that scrolls sideways so the
 * page does not (ADR-0008). It takes focus, so the arrow keys can scroll it: a
 * keyboard cannot otherwise reach what is off to the side. It is a group and
 * not a region, so several in one answer do not each add a landmark.
 */
export function ScrollRegion({
  label,
  className,
  focusOnlyWhenOverflowing = false,
  children,
}: ScrollRegionProps) {
  const box = useRef<HTMLDivElement>(null)
  const [overflowing, setOverflowing] = useState(false)
  useLayoutEffect(() => {
    const element = box.current
    if (!focusOnlyWhenOverflowing || element === null) return
    const measure = () => {
      setOverflowing(element.scrollWidth > element.clientWidth)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => {
      observer.disconnect()
    }
  }, [focusOnlyWhenOverflowing])
  return (
    <div
      ref={box}
      role="group"
      aria-label={label}
      tabIndex={focusOnlyWhenOverflowing && !overflowing ? undefined : 0}
      className={[styles.region, className].filter(Boolean).join(' ')}
    >
      {children}
    </div>
  )
}
