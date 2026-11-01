// The colour tokens as text on the backgrounds they are used on. The story
// test runs axe's colour-contrast rule on it, in light and in dark, so a token
// change that breaks AA fails here before it reaches a component.
import type { Meta, StoryObj } from '@storybook/react-vite'

import styles from './Tokens.module.css'

interface Pair {
  name: string
  color: string
  background: string
}

const pairs: Pair[] = [
  { name: 'text on bg', color: 'var(--color-text)', background: 'var(--color-bg)' },
  { name: 'text on surface', color: 'var(--color-text)', background: 'var(--color-surface)' },
  {
    name: 'text on surface-strong',
    color: 'var(--color-text)',
    background: 'var(--color-surface-strong)',
  },
  { name: 'muted on bg', color: 'var(--color-text-muted)', background: 'var(--color-bg)' },
  {
    name: 'muted on surface',
    color: 'var(--color-text-muted)',
    background: 'var(--color-surface)',
  },
  {
    name: 'muted on surface-strong',
    color: 'var(--color-text-muted)',
    background: 'var(--color-surface-strong)',
  },
  { name: 'accent on bg', color: 'var(--color-accent)', background: 'var(--color-bg)' },
  { name: 'accent on surface', color: 'var(--color-accent)', background: 'var(--color-surface)' },
  {
    name: 'on-accent on accent',
    color: 'var(--color-on-accent)',
    background: 'var(--color-accent)',
  },
  {
    name: 'danger on danger-surface',
    color: 'var(--color-danger)',
    background: 'var(--color-danger-surface)',
  },
  { name: 'success on bg', color: 'var(--color-success)', background: 'var(--color-bg)' },
  { name: 'danger on bg', color: 'var(--color-danger)', background: 'var(--color-bg)' },
  { name: 'text on highlight', color: 'var(--color-text)', background: 'var(--color-highlight)' },
]

const lists = ['vector', 'keyword', 'exact']

function Tokens() {
  return (
    <main className={styles.page}>
      <h1>Colour tokens</h1>
      <ul className={styles.grid}>
        {pairs.map((pair) => (
          <li
            key={pair.name}
            className={styles.swatch}
            style={{ color: pair.color, background: pair.background }}
          >
            <span className={styles.name}>{pair.name}</span>
          </li>
        ))}
      </ul>
      <h2>Retrieval lists</h2>
      <ul className={styles.grid}>
        {lists.map((list) => (
          <li key={list} className={styles.swatch}>
            <span className={styles.name}>--color-list-{list}</span>
            <div className={styles.bar} style={{ background: `var(--color-list-${list})` }} />
          </li>
        ))}
      </ul>
    </main>
  )
}

const meta = {
  title: 'Foundations/Tokens',
  component: Tokens,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Tokens>

export default meta

export const Colours: StoryObj<typeof meta> = {}
