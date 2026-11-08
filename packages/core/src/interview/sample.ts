// The test of M8's hypothesis (ADR-0018): a blind sample of 20 shown generated questions, 10 from
// each source and at least 3 of React's on Pitfall callouts, from a fixed seed and in shuffled
// order. The owner labels each on two counts, and H holds when at most 2 fail on either.
import { createHash } from 'node:crypto'

import { seeded } from '../eval/bootstrap.ts'
import { shuffled, wilsonInterval } from '../eval/calibrate.ts'
import type { QuestionRow } from './store.ts'

/** 2026-11-08, the day ADR-0018 fixed the rule. */
export const BANK_SAMPLE_SEED = 20_261_108

export interface BankSamplePlan {
  perSource: number
  /** Questions on callouts of this kind that a source's share must hold. */
  atLeast: { source: string; kind: 'pitfall'; count: number }
  /** At most this many may fail, on either count. */
  allowed: number
}

export const BANK_SAMPLE_PLAN: BankSamplePlan = {
  perSource: 10,
  atLeast: { source: 'react', kind: 'pitfall', count: 3 },
  allowed: 2,
}

const isGenerated = (row: QuestionRow): boolean =>
  row.status === 'shown' && (row.question.kind === 'theory' || row.question.kind === 'pitfall')

const byId = (a: QuestionRow, b: QuestionRow): number => a.question.id.localeCompare(b.question.id)

/**
 * The sample, from each source's shown generated questions. A source with too few gives what it
 * has. It reads nothing of the checker but which questions it kept, since those are the ones the
 * app shows.
 */
export function bankSample(
  rowsBySource: ReadonlyMap<string, readonly QuestionRow[]>,
  plan: BankSamplePlan = BANK_SAMPLE_PLAN,
  seed: number = BANK_SAMPLE_SEED,
): QuestionRow[] {
  const random = seeded(seed)
  const sample = [...rowsBySource.keys()].sort().flatMap((source) => {
    const candidates = shuffled(
      [...(rowsBySource.get(source) ?? [])].filter(isGenerated).sort(byId),
      random,
    )
    const required =
      plan.atLeast.source === source
        ? candidates
            .filter((row) => row.question.kind === plan.atLeast.kind)
            .slice(0, plan.atLeast.count)
        : []
    const rest = candidates.filter((row) => !required.includes(row))
    return [...required, ...rest].slice(0, plan.perSource)
  })
  return shuffled(sample, random)
}

/** Which questions a sheet showed, so that labels cannot be read against another sample. */
export function bankSampleHash(sample: readonly QuestionRow[]): string {
  return createHash('sha256')
    .update(
      sample
        .map((row) => row.question.id)
        .sort()
        .join(),
    )
    .digest('hex')
    .slice(0, 12)
}

/** One label of the sheet: the item, and the owner's two counts. */
export interface BankLabel {
  item: number
  answerable: boolean
  correct: boolean
}

export interface BankCheck {
  sample: string
  labelled: number
  failed: {
    item: number
    questionId: string
    source: string
    kind: string
    answerable: boolean
    correct: boolean
  }[]
  /** Questions that passed both counts, with their Wilson interval. */
  passed: { count: number; of: number; low: number; high: number }
  allowed: number
  holds: boolean
}

/** H against the owner's labels: it holds when at most `allowed` questions fail on either count. */
export function checkBank(
  sample: readonly QuestionRow[],
  labels: readonly BankLabel[],
  plan: BankSamplePlan = BANK_SAMPLE_PLAN,
): BankCheck {
  const failed = labels.flatMap((label) => {
    const row = sample[label.item - 1]
    if (row === undefined) throw new Error(`there is no item ${String(label.item)}`)
    return label.answerable && label.correct
      ? []
      : [
          {
            item: label.item,
            questionId: row.question.id,
            source: row.question.source,
            kind: row.question.kind,
            answerable: label.answerable,
            correct: label.correct,
          },
        ]
  })
  const count = labels.length - failed.length
  const [low, high] = wilsonInterval(count, labels.length)
  return {
    sample: bankSampleHash(sample),
    labelled: labels.length,
    failed,
    passed: { count, of: labels.length, low, high },
    allowed: plan.allowed,
    holds: failed.length <= plan.allowed,
  }
}
