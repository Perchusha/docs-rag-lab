import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'

import styles from './Composer.module.css'

export interface DocTypeSelectProps {
  docTypes: readonly string[]
  /** Plain-language names by doc type. A doc type without one is written out from its ID. */
  labels?: Readonly<Record<string, string>> | undefined
  /** The doc types to search in; empty means all of them. */
  selected: readonly string[]
  onChange: (selected: string[]) => void
}

function labelOf(docType: string, labels: DocTypeSelectProps['labels']): string {
  const label = labels?.[docType]
  if (label !== undefined) return label
  const words = docType.replaceAll('-', ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** "All docs", up to two names, or how many. */
export function docTypeSummary(
  docTypes: readonly string[],
  selected: readonly string[],
  labels?: DocTypeSelectProps['labels'],
): string {
  if (selected.length === 0 || selected.length === docTypes.length) return 'All docs'
  if (selected.length <= 2) return selected.map((d) => labelOf(d, labels)).join(', ')
  return `${String(selected.length)} kinds of docs`
}

/**
 * "Search in: All docs": a disclosure button over native checkboxes, which gives
 * keyboards and screen readers everything a custom listbox would have to rebuild.
 * Esc closes it and returns focus to the button. A click elsewhere, or focus
 * moving elsewhere, closes it too.
 */
export function DocTypeSelect({ docTypes, labels, selected, onChange }: DocTypeSelectProps) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && root.current?.contains(event.target) !== true) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open])

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && open) {
      event.stopPropagation()
      setOpen(false)
      button.current?.focus()
    }
  }

  return (
    <div
      className={styles.select}
      ref={root}
      onKeyDown={onKeyDown}
      onBlur={(event) => {
        // No relatedTarget: a press on a label, which gives focus to its checkbox.
        const next = event.relatedTarget
        if (next instanceof Node && !event.currentTarget.contains(next)) setOpen(false)
      }}
    >
      <button
        ref={button}
        type="button"
        className={styles.selectButton}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          setOpen((value) => !value)
        }}
      >
        Search in: {docTypeSummary(docTypes, selected, labels)}
        <span aria-hidden="true"> ▾</span>
      </button>
      <div
        id={id}
        role="group"
        aria-label="Search in"
        hidden={!open}
        className={styles.selectPanel}
      >
        {docTypes.map((docType) => (
          <label key={docType} className={styles.selectItem}>
            <input
              type="checkbox"
              checked={selected.includes(docType)}
              onKeyDown={(event) => {
                // Enter in a form submits it, which here would send a half-written question.
                if (event.key !== 'Enter') return
                event.preventDefault()
                event.currentTarget.click()
              }}
              onChange={(event) => {
                onChange(
                  event.target.checked
                    ? docTypes.filter((d) => d === docType || selected.includes(d))
                    : selected.filter((d) => d !== docType),
                )
              }}
            />
            {labelOf(docType, labels)}
          </label>
        ))}
      </div>
    </div>
  )
}
