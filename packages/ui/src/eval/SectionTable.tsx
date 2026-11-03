// One question and its numbers (ADR-0013): every number has its interval in the same cell and
// its comparison in the same row. The graphic only repeats the intervals, so it is hidden from
// screen readers, and each column keeps one shape, so nothing depends on colour.
import { useId } from 'react'

import type { DashboardRow, DashboardSection, EvalFigure } from '@docs-rag-lab/contracts'

import {
  figurePosition,
  figureWords,
  runToRunWords,
  SHAPE_GLYPHS,
  shapeFor,
  splitWords,
  verdictWords,
} from '../lib/eval.ts'
import { ScrollRegion } from '../lib/ScrollRegion.tsx'
import styles from './EvalDashboard.module.css'

const percent = (share: number): string => `${String(share * 100)}%`

function IntervalGraphic({ row, columns }: { row: DashboardRow; columns: readonly string[] }) {
  const placed = row.figures.map((figure, i) => ({
    position: figurePosition(figure),
    shape: shapeFor(columns[i] ?? '', i),
  }))
  if (placed.every(({ position }) => position === null)) return null
  return (
    <span aria-hidden="true" className={styles.graphic} data-drl-interval="">
      {placed.map(({ position, shape }, i) => (
        <span key={i} className={styles.track}>
          {position !== null && (
            <>
              <span
                className={styles.whisker}
                style={{
                  insetInlineStart: percent(position.low),
                  width: percent(position.high - position.low),
                }}
              />
              <span
                className={styles.dot}
                data-shape={shape}
                style={{ insetInlineStart: percent(position.value) }}
              />
            </>
          )}
        </span>
      ))}
    </span>
  )
}

function FigureCell({ figure }: { figure: EvalFigure }) {
  return (
    <td
      className={
        figure.kind === 'none' ? styles.muted : figure.kind === 'text' ? undefined : styles.figure
      }
    >
      {figureWords(figure)}
    </td>
  )
}

export function SectionTable({
  section,
  level = 2,
}: {
  section: DashboardSection
  /** The heading level: 2 on the first screen, 3 inside a tab. */
  level?: 2 | 3
}) {
  const id = useId()
  const Heading = `h${String(level)}` as 'h2' | 'h3'
  return (
    <section aria-labelledby={id} className={styles.section}>
      <Heading id={id} className={styles.question}>
        {section.question}
      </Heading>
      <p className={styles.summary}>{section.summary}</p>
      <ScrollRegion label={section.question} focusOnlyWhenOverflowing>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">
                <span className={styles.srOnly}>What is measured</span>
              </th>
              {section.columns.map((column, i) => (
                <th key={column} scope="col">
                  <span aria-hidden="true" className={styles.glyph}>
                    {SHAPE_GLYPHS[shapeFor(column, i)]}
                  </span>{' '}
                  {column}
                </th>
              ))}
              <th scope="col" aria-hidden="true" className={styles.scale}>
                {section.scale}
              </th>
              <th scope="col">Compared, question by question</th>
              {section.showRunToRun && (
                <th scope="col" className={styles.wraps}>
                  Run to run (hybrid twice)
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {section.rows.map((row) => (
              <tr key={row.id}>
                <th scope="row" className={styles.rowLabel}>
                  {row.label}
                  {row.note !== undefined && <span className={styles.note}> {row.note}</span>}
                  {row.exploratory && <span className={styles.exploratory}> Exploratory</span>}
                </th>
                {row.figures.map((figure, i) => (
                  <FigureCell key={i} figure={figure} />
                ))}
                {/* Hidden with its header, so that the other cells keep their headers. */}
                <td aria-hidden="true" className={styles.graphicCell}>
                  <IntervalGraphic row={row} columns={section.columns} />
                </td>
                <td>
                  {row.comparisons.length === 0 && <span className={styles.muted}>-</span>}
                  {row.comparisons.map((split) => (
                    <div key={`${split.a}-${split.b}`} className={styles.split}>
                      {splitWords(split)}: <strong>{verdictWords(split)}</strong>
                    </div>
                  ))}
                </td>
                {section.showRunToRun && (
                  <td className={styles.figure}>
                    {row.runToRun === null && row.comparisons.length === 0
                      ? '-'
                      : runToRunWords(row.runToRun)}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollRegion>
    </section>
  )
}
