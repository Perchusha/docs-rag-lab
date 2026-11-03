// Words and positions for the eval dashboard. Numbers and verdicts come from core (ADR-0013);
// this only says them, so the components stay thin.
import type { DifferenceVerdict, EvalFigure, EvalSplit } from '@docs-rag-lab/contracts'

const percent = (share: number): string => `${String(Math.round(share * 100))}%`

/** "77-96%". */
export function percentRange(low: number, high: number): string {
  return `${String(Math.round(low * 100))}-${percent(high)}`
}

/** The number and, in the same words, its uncertainty. */
export function figureWords(figure: EvalFigure): string {
  switch (figure.kind) {
    case 'share':
      return `${String(figure.count)} of ${String(figure.of)} (${percentRange(figure.low, figure.high)})`
    case 'mean':
      return `${figure.value.toFixed(3)} (${figure.low.toFixed(2)}-${figure.high.toFixed(2)})`
    case 'none':
      return figure.reason
    case 'text':
      return figure.text
  }
}

/** Where a figure sits on the shared 0 to 1 scale of its row, or null when it has no place. */
export function figurePosition(
  figure: EvalFigure,
): { value: number; low: number; high: number } | null {
  if (figure.kind === 'share') {
    return {
      value: figure.of === 0 ? 0 : figure.count / figure.of,
      low: figure.low,
      high: figure.high,
    }
  }
  if (figure.kind === 'mean') return { value: figure.value, low: figure.low, high: figure.high }
  return null
}

export type IntervalShape = 'circle' | 'square' | 'diamond'

const COLUMN_SHAPES: Record<string, IntervalShape> = {
  'No RAG': 'circle',
  Vector: 'square',
  Hybrid: 'diamond',
}
const SHAPES: readonly IntervalShape[] = ['square', 'diamond', 'circle']

/** The same column keeps one shape on the whole page, so state is never colour alone. */
export function shapeFor(column: string, index: number): IntervalShape {
  return COLUMN_SHAPES[column] ?? SHAPES[index % SHAPES.length] ?? 'circle'
}

export const SHAPE_GLYPHS: Record<IntervalShape, string> = {
  circle: '○',
  square: '■',
  diamond: '◆',
}

export function verdictWords(split: Pick<EvalSplit, 'a' | 'b' | 'verdict'>): string {
  const words: Record<DifferenceVerdict, string> = {
    a: `${split.a} better`,
    b: `${split.b} better`,
    noise: 'Noise',
    'not-significant': 'Not significant',
    mixed: 'Mixed',
    'too-few': 'Too few to say',
  }
  return words[split.verdict]
}

const pWords = (p: number): string => (p < 0.01 ? 'p < 0.01' : `p = ${p.toFixed(2)}`)

/** "Vector 14, Hybrid 7, tied 19, p = 0.19". */
export function splitWords(split: EvalSplit): string {
  return `${split.a} ${String(split.aAhead)}, ${split.b} ${String(split.bAhead)}, tied ${String(split.tied)}, ${pWords(split.p)}`
}

/** How many questions differ between two runs of hybrid, in plain words. */
export function runToRunWords(questions: number | null): string {
  if (questions === null) return 'not measured'
  if (questions === 0) return 'none'
  return questions === 1 ? '1 question differs' : `${String(questions)} questions differ`
}

export const dimensionWords = {
  correctness: 'correctness',
  refusal: 'refusals',
  support: 'citations',
} as const

/** "0 questions stale", and any to re-read. */
export function staleWords(stale: number, review: number): string {
  const count = stale === 1 ? '1 question stale' : `${String(stale)} questions stale`
  return review === 0 ? count : `${count}, ${String(review)} to re-read`
}
