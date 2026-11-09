import styles from './Interview.module.css'

export interface SourceChoice {
  id: string
  title: string
  /** Questions in the bank, once the overview has said. */
  questions?: number | undefined
}

export interface TechPickerProps {
  sources: readonly SourceChoice[]
  chosen: readonly string[]
  onChange: (chosen: string[]) => void
}

/** The technologies to practise. One always stays chosen, so a deck is never of nothing. */
export function TechPicker({ sources, chosen, onChange }: TechPickerProps) {
  const last = chosen.length === 1
  return (
    <fieldset className={styles.picker}>
      <legend>Technologies</legend>
      {sources.map((source) => {
        const checked = chosen.includes(source.id)
        return (
          <label key={source.id} className={styles.choice}>
            <input
              type="checkbox"
              checked={checked}
              disabled={checked && last}
              aria-describedby={checked && last ? 'drl-picker-last' : undefined}
              onChange={() => {
                onChange(
                  sources
                    .map(({ id }) => id)
                    .filter((id) => (id === source.id ? !checked : chosen.includes(id))),
                )
              }}
            />
            {source.title}
            {source.questions !== undefined && (
              <span className={styles.muted}>{`${String(source.questions)} questions`}</span>
            )}
          </label>
        )
      })}
      {last && (
        <p id="drl-picker-last" className={styles.muted}>
          One technology stays chosen.
        </p>
      )}
    </fieldset>
  )
}
