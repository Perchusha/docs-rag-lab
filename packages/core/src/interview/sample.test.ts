import type { BankQuestion, QuestionKind } from '@docs-rag-lab/contracts'
import { describe, expect, it } from 'vitest'

import { BANK_SAMPLE_PLAN, bankSample, bankSampleHash, checkBank } from './sample.ts'
import type { QuestionRow } from './store.ts'

const row = (
  source: string,
  id: string,
  kind: QuestionKind,
  status: QuestionRow['status'] = 'shown',
): QuestionRow => ({
  row: 'question',
  status,
  textHash: 'h',
  question: {
    id,
    source,
    kind,
    topicId: 't',
    prompt: 'Q?',
    answer: 'A.',
    citation: { url: 'u', title: 't', sectionPath: [], docPath: 'p', chunkId: id },
    verifiedBy: kind.startsWith('compiler') ? 'compiler' : 'checker',
  } satisfies BankQuestion,
})

const many = (source: string, kind: QuestionKind, count: number, prefix = kind): QuestionRow[] =>
  Array.from({ length: count }, (_, i) =>
    row(source, `${source}-${prefix}-${String(i).padStart(2, '0')}`, kind),
  )

const bySource = new Map<string, QuestionRow[]>([
  [
    'typescript',
    [
      ...many('typescript', 'theory', 30),
      ...many('typescript', 'compiler-type', 30),
      row('typescript', 'ts-dropped', 'theory', 'dropped-check'),
    ],
  ],
  ['react', [...many('react', 'theory', 30), ...many('react', 'pitfall', 4)]],
])

describe('bankSample (ADR-0018)', () => {
  const sample = bankSample(bySource)

  it('takes 10 shown generated questions from each source', () => {
    expect(sample).toHaveLength(20)
    for (const source of ['typescript', 'react']) {
      expect(sample.filter((item) => item.question.source === source)).toHaveLength(10)
    }
    expect(sample.every((item) => item.status === 'shown')).toBe(true)
    expect(sample.every((item) => ['theory', 'pitfall'].includes(item.question.kind))).toBe(true)
  })

  it('holds at least 3 of React on Pitfall callouts', () => {
    expect(sample.filter((item) => item.question.kind === 'pitfall').length).toBeGreaterThanOrEqual(
      3,
    )
  })

  it('is the same every time, whatever order the rows came in, and shuffled', () => {
    const reversed = new Map([...bySource].map(([source, rows]) => [source, [...rows].reverse()]))

    expect(bankSample(reversed).map((item) => item.question.id)).toEqual(
      sample.map((item) => item.question.id),
    )
    expect(sample.slice(0, 10).every((item) => item.question.source === 'react')).toBe(false)
    expect(bankSample(bySource, BANK_SAMPLE_PLAN, 1).map((item) => item.question.id)).not.toEqual(
      sample.map((item) => item.question.id),
    )
  })

  it('stays the same when the owner rejects one of its questions after the draw', () => {
    const picked = sample[0]
    if (picked === undefined) throw new Error('no sample')
    const rejected = new Map(
      [...bySource].map(([source, rows]) => [
        source,
        rows.map((item): QuestionRow =>
          item === picked ? { ...item, status: 'rejected-owner', ownerReason: 'Wrong.' } : item,
        ),
      ]),
    )

    expect(bankSampleHash(bankSample(rejected))).toBe(bankSampleHash(sample))
  })

  it('gives what a source has when it has too few', () => {
    const few = bankSample(new Map([['react', many('react', 'pitfall', 2)]]))

    expect(few).toHaveLength(2)
  })
})

describe('checkBank', () => {
  const sample = bankSample(bySource)
  const labels = sample.map((_, i) => ({ item: i + 1, answerable: true, correct: true }))

  it('holds with at most 2 failing on either count, with its interval', () => {
    const two = labels.map((label) =>
      label.item === 3
        ? { ...label, correct: false }
        : label.item === 7
          ? { ...label, answerable: false }
          : label,
    )

    const check = checkBank(sample, two)
    expect(check).toMatchObject({
      sample: bankSampleHash(sample),
      labelled: 20,
      allowed: 2,
      holds: true,
    })
    expect(check.passed.count).toBe(18)
    expect(check.passed.low).toBeGreaterThan(0.6)
    expect(check.failed.map(({ item }) => item)).toEqual([3, 7])
  })

  it('misses with 3 failing', () => {
    const three = labels.map((label) => (label.item <= 3 ? { ...label, correct: false } : label))

    expect(checkBank(sample, three).holds).toBe(false)
  })

  it('refuses a label for an item the sheet did not have', () => {
    expect(() => checkBank(sample, [{ item: 21, answerable: true, correct: true }])).toThrow(
      'there is no item 21',
    )
  })
})
