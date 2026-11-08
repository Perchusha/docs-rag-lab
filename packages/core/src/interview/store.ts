// The interview bank, committed: interview/bank/<source>.jsonl (ADR-0018). Generated questions
// cannot be made again, since Claude would write other text, so they are kept with the models and
// prompt hashes that wrote and checked them, and a run reads them before it calls anything. A
// header line, then one line per question and one per chunk that went to the generator, sorted
// once a run is done.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import type { BankQuestion } from '@docs-rag-lab/contracts'

import { withoutEmDash } from './text.ts'

export interface BankHeader {
  version: 1
  source: string
  /** The index the bank was built from: compiled for a source with a compiler, else plain. */
  variant: 'plain' | 'compiled'
  docsCommit: string
  /** The model and prompt hash that wrote the generated questions. */
  generator: string
  /** The model and prompt hash that checked them. */
  checker: string
}

/** Shown, or why not: the quote is not in its chunk, the code block does not exist, or the checker. */
export type QuestionStatus = 'shown' | 'dropped-quote' | 'dropped-code' | 'dropped-check'

export interface QuestionRow {
  row: 'question'
  status: QuestionStatus
  /** The checker's reason, for a question it read. */
  reason?: string
  /** The text of the chunk the question was made from. A question whose chunk changed is stale. */
  textHash: string
  question: BankQuestion
}

/** A chunk that went to the generator, so that one which gave no question is not sent again. */
export interface ChunkRow {
  row: 'chunk'
  chunkId: string
  textHash: string
  questions: number
}

export type BankRow = QuestionRow | ChunkRow

export interface Bank {
  header: BankHeader
  rows: BankRow[]
}

export function bankPath(root: string, sourceId: string): string {
  return join(root, 'interview', 'bank', `${sourceId}.jsonl`)
}

/** One line, with every em dash a hyphen, so that the file passes the repository's check. */
const line = (value: BankHeader | BankRow): string => `${withoutEmDash(JSON.stringify(value))}\n`

export function readBank(path: string): Bank | undefined {
  if (!existsSync(path)) return undefined
  const [first, ...rest] = readFileSync(path, 'utf8')
    .split('\n')
    .filter((text) => text !== '')
  if (first === undefined) return undefined
  const { version, ...header } = JSON.parse(first) as Omit<BankHeader, 'version'> & {
    version: unknown
  }
  if (version !== 1) throw new Error(`${path}: unknown bank version ${String(version)}`)
  return { header: { version, ...header }, rows: rest.map((text) => JSON.parse(text) as BankRow) }
}

const chunkOf = (row: BankRow): string =>
  row.row === 'chunk' ? row.chunkId : row.question.citation.chunkId

/** Chunk ID order, each chunk's questions before its chunk row, so that a file reads the same however it was made. */
function compareRows(a: BankRow, b: BankRow): number {
  const byChunk = chunkOf(a).localeCompare(chunkOf(b))
  if (byChunk !== 0) return byChunk
  if (a.row !== b.row) return a.row === 'question' ? -1 : 1
  return a.row === 'question' && b.row === 'question'
    ? a.question.id.localeCompare(b.question.id)
    : 0
}

export function writeBank(path: string, header: BankHeader, rows: Iterable<BankRow>): void {
  const sorted = [...rows].sort(compareRows)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, [header, ...sorted].map(line).join(''))
}

/** More lines, as soon as they were paid for, so that a run that stops keeps what it got. */
export function appendBankRows(path: string, rows: readonly BankRow[]): void {
  appendFileSync(path, rows.map(line).join(''))
}

/**
 * The generated rows of a bank that a run can keep: those written and checked by the same models
 * and prompts. Compiler questions are made again on every run, so none is kept from the file.
 */
export function keptGeneratedRows(
  bank: Bank | undefined,
  expected: Pick<BankHeader, 'source' | 'variant' | 'generator' | 'checker'>,
): BankRow[] {
  if (bank === undefined) return []
  const { header } = bank
  const same =
    header.source === expected.source &&
    header.variant === expected.variant &&
    header.generator === expected.generator &&
    header.checker === expected.checker
  if (!same) return []
  return bank.rows.filter((row) => row.row === 'chunk' || row.question.verifiedBy === 'checker')
}
