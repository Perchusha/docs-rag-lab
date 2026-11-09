// The bank as the interview-prep app reads it (ADR-0018): every source's topics, from its index,
// the questions it shows whose chunk still has the text they were made from, and for each
// generated one the section of that chunk its quote is in. A source with no bank or no index yet
// has nothing to practise.
import type { BankTopic, QuestionPassage } from '@docs-rag-lab/contracts'
import type { Source } from '@docs-rag-lab/source-kit'

import { IndexNotFoundError, openIndexes } from '../indexes.ts'
import { bankDocuments } from './documents.ts'
import type { LoadedBank } from './progress.ts'
import { quotePassage } from './sections.ts'
import { bankPath, readBank } from './store.ts'

export interface LoadBankOptions {
  /** The repository root, where interview/bank/ is. */
  root: string
  /** The data folder, where the indexes are. */
  dataDir: string
  sources: readonly Source[]
}

export function loadInterviewBank(options: LoadBankOptions): LoadedBank {
  const topics: BankTopic[] = []
  const questions: LoadedBank['questions'] = []
  const passages = new Map<string, QuestionPassage>()
  for (const source of options.sources) {
    if (source.interviewTopic === undefined) continue
    const bank = readBank(bankPath(options.root, source.id))
    if (bank === undefined) continue
    let indexes
    try {
      indexes = openIndexes(options.dataDir, source.id, {
        create: false,
        ...(bank.header.variant === 'compiled' ? { variant: 'compiled' as const } : {}),
      })
    } catch (error) {
      if (error instanceof IndexNotFoundError) continue
      throw error
    }
    try {
      const documents = bankDocuments(source, indexes.index)
      const chunks = new Map(
        documents.flatMap((document) => document.chunks.map((chunk) => [chunk.id, chunk])),
      )
      const seen = new Set<string>()
      for (const { topic } of documents) {
        if (seen.has(topic.id)) continue
        seen.add(topic.id)
        topics.push({ source: source.id, ...topic })
      }
      for (const row of bank.rows) {
        if (row.row !== 'question' || row.status !== 'shown') continue
        const { question } = row
        const chunk = chunks.get(question.citation.chunkId)
        if (chunk?.textHash !== row.textHash) continue
        questions.push(question)
        const passage =
          question.quote === undefined ? undefined : quotePassage(chunk, question.quote, source)
        if (passage !== undefined) passages.set(question.id, passage)
      }
    } finally {
      indexes.close()
    }
  }
  return { topics, questions, passages }
}
