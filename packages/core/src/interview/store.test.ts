import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { BankQuestion } from '@docs-rag-lab/contracts'
import { describe, expect, it } from 'vitest'

import {
  appendBankRows,
  bankPath,
  keptGeneratedRows,
  readBank,
  writeBank,
  type BankHeader,
  type BankRow,
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

  it('refuses a version it does not know', () => {
    const path = join(dir(), 'react.jsonl')
    writeBank(path, { ...header, version: 2 as 1 }, [])

    expect(() => readBank(path)).toThrow('unknown bank version 2')
  })
})
