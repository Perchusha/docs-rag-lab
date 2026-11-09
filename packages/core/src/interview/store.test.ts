import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { BankQuestion } from '@docs-rag-lab/contracts'
import { describe, expect, it } from 'vitest'

import {
  appendBankRows,
  bankPath,
  keptGeneratedRows,
  ownerRejections,
  readBank,
  rejectQuestion,
  withRejection,
  writeBank,
  type BankHeader,
  type BankRow,
  type QuestionRow,
} from './store.ts'

const EM_DASH = String.fromCodePoint(0x2014)

const header: BankHeader = {
  version: 1,
  source: 'react',
  variant: 'plain',
  docsCommit: 'abc',
  generator: 'haiku:111',
  checker: 'sonnet:222',
}

const question = (
  id: string,
  chunkId: string,
  verifiedBy: BankQuestion['verifiedBy'],
): BankQuestion => ({
  id,
  source: 'react',
  kind: verifiedBy === 'compiler' ? 'compiler-type' : 'theory',
  topicId: 'learn/state',
  prompt: `Question ${id}${EM_DASH}why?`,
  answer: 'Because.',
  citation: { url: 'u', title: 't', sectionPath: [], docPath: 'p', chunkId },
  verifiedBy,
})

const rows: BankRow[] = [
  { row: 'chunk', chunkId: 'b', textHash: 'hb', questions: 1 },
  { row: 'question', status: 'shown', textHash: 'hb', question: question('q2', 'b', 'checker') },
  {
    row: 'question',
    status: 'dropped-check',
    reason: 'Not in the chunk.',
    textHash: 'ha',
    question: question('q1', 'a', 'checker'),
  },
  { row: 'question', status: 'shown', textHash: 'ha', question: question('c1', 'a', 'compiler') },
]

describe('the bank file (ADR-0018)', () => {
  const dir = () => mkdtempSync(join(tmpdir(), 'bank-'))

  it('lives under interview/bank, one file per source', () => {
    expect(bankPath('/repo', 'react').replaceAll('\\', '/')).toBe(
      '/repo/interview/bank/react.jsonl',
    )
  })

  it('reads back what it wrote, sorted by chunk with each chunk row after its questions', () => {
    const path = join(dir(), 'react.jsonl')
    writeBank(path, header, rows)

    const bank = readBank(path)
    expect(bank?.header).toEqual(header)
    expect(
      bank?.rows.map((row) => (row.row === 'chunk' ? `chunk ${row.chunkId}` : row.question.id)),
    ).toEqual(['c1', 'q1', 'q2', 'chunk b'])
  })

  it('holds no em dash, so that it passes the repository check', () => {
    const path = join(dir(), 'react.jsonl')
    writeBank(path, header, rows)
    appendBankRows(path, rows.slice(1, 2))

    expect(readFileSync(path, 'utf8')).not.toContain(EM_DASH)
    expect(readBank(path)?.rows.at(-1)).toMatchObject({ question: { prompt: 'Question q2-why?' } })
  })

  it('keeps generated rows only for the same models and prompts, and never compiler questions', () => {
    const path = join(dir(), 'react.jsonl')
    writeBank(path, header, rows)
    const bank = readBank(path)

    const kept = keptGeneratedRows(bank, header)
    expect(kept.map((row) => (row.row === 'chunk' ? 'chunk' : row.question.id)).sort()).toEqual([
      'chunk',
      'q1',
      'q2',
    ])
    expect(keptGeneratedRows(bank, { ...header, checker: 'sonnet:333' })).toEqual([])
    expect(keptGeneratedRows(undefined, header)).toEqual([])
  })

  it('rejects a shown question by the owner, keeping it in the file with the reason', () => {
    const path = join(dir(), 'react.jsonl')
    const bank = rejectQuestion({ header, rows }, 'q2', `  Says set once${EM_DASH}it is not.  `)
    writeBank(path, bank.header, bank.rows)

    const q2 = (list: readonly BankRow[]) =>
      list.find((item): item is QuestionRow => item.row === 'question' && item.question.id === 'q2')
    const read = q2(readBank(path)?.rows ?? [])
    expect(read?.status).toBe('rejected-owner')
    expect(read?.ownerReason).toBe('Says set once-it is not.')
    expect(q2(rejectQuestion(bank, 'q2', 'Other reason.').rows)?.ownerReason).toBe('Other reason.')
    // A run keeps the rejection of a generated question with the rest of its rows.
    expect(keptGeneratedRows(bank, header)).toContainEqual(q2(bank.rows))
  })

  it('refuses a rejection with no reason, of no question, or of one never shown', () => {
    const bank = { header, rows }

    expect(() => rejectQuestion(bank, 'q2', '  ')).toThrow('a rejection needs a reason')
    expect(() => rejectQuestion(bank, 'nope', 'Wrong.')).toThrow(
      'the react bank has no question nope',
    )
    expect(() => rejectQuestion(bank, 'q1', 'Wrong.')).toThrow(
      'question q1 is dropped-check, so the app never showed it',
    )
  })

  it('puts a rejection back on a question made again from the same text, and only then', () => {
    const rejected = ownerRejections(rejectQuestion({ header, rows }, 'c1', 'Wrong.'))
    const compiler = rows[3] as QuestionRow

    expect(withRejection(compiler, rejected)).toEqual({
      ...compiler,
      status: 'rejected-owner',
      ownerReason: 'Wrong.',
    })
    expect(withRejection({ ...compiler, textHash: 'changed' }, rejected).status).toBe('shown')
    expect(ownerRejections(undefined).size).toBe(0)
  })

  it('refuses a version it does not know', () => {
    const path = join(dir(), 'react.jsonl')
    writeBank(path, { ...header, version: 2 as 1 }, [])

    expect(() => readBank(path)).toThrow('unknown bank version 2')
  })
})
