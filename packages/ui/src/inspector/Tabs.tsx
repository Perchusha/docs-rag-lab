// Tabs after the WAI-ARIA Authoring Practices tabs pattern: the tab list is one
// tab stop, the arrow keys move between tabs (wrapping), Home and End go to the
// first and last, and a tab is selected as soon as it gets focus.
import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react'

import styles from './Tabs.module.css'

export interface Tab<Id extends string> {
  id: Id
  label: string
  /** Rendered only while the tab is selected. */
  panel: ReactNode
}

export interface TabsProps<Id extends string> {
  /** The tab list's accessible name. */
  label: string
  tabs: readonly Tab<Id>[]
  selected: Id
  onSelect: (id: Id) => void
}

export function Tabs<Id extends string>({ label, tabs, selected, onSelect }: TabsProps<Id>) {
  const base = useId()
  const buttons = useRef(new Map<Id, HTMLButtonElement>())
  const current = Math.max(
    0,
    tabs.findIndex((tab) => tab.id === selected),
  )

  const moveTo = (index: number) => {
    const tab = tabs[(index + tabs.length) % tabs.length]
    if (tab === undefined) return
    onSelect(tab.id)
    buttons.current.get(tab.id)?.focus()
  }

  const onKeyDown = (event: KeyboardEvent) => {
    // Alt+Left and Alt+Right are the browser's Back and Forward.
    if (event.altKey || event.ctrlKey || event.metaKey) return
    const target = {
      ArrowRight: current + 1,
      ArrowLeft: current - 1,
      Home: 0,
      End: tabs.length - 1,
    }[event.key]
    if (target === undefined) return
    event.preventDefault()
    moveTo(target)
  }

  return (
    <div>
      <div role="tablist" aria-label={label} className={styles.tablist} onKeyDown={onKeyDown}>
        {tabs.map((tab) => {
          const active = tab.id === selected
          return (
            <button
              key={tab.id}
              ref={(element) => {
                if (element === null) buttons.current.delete(tab.id)
                else buttons.current.set(tab.id, element)
              }}
              type="button"
              role="tab"
              id={`${base}-tab-${tab.id}`}
              aria-selected={active}
              aria-controls={`${base}-panel-${tab.id}`}
              tabIndex={active ? 0 : -1}
              className={styles.tab}
              onClick={() => {
                onSelect(tab.id)
              }}
            >
              {tab.label}
            </button>
          )
        })}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`${base}-panel-${tab.id}`}
          aria-labelledby={`${base}-tab-${tab.id}`}
          hidden={tab.id !== selected}
          tabIndex={0}
          className={styles.panel}
        >
          {tab.id === selected ? tab.panel : null}
        </div>
      ))}
    </div>
  )
}
