// The section of a chunk that a quote or an example is in (ADR-0018). A chunk can hold several
// sections: the chunker writes each nested heading as a markdown heading line at the start of a
// block's span, and records the fragments of every section it contains, in order. A card links to
// the section its quote is in, not the one its chunk starts in, and shows that section.
import type { QuestionCitation, QuestionPassage } from '@docs-rag-lab/contracts'

import { citationUrl, type BankChunk, type BankDocument } from './documents.ts'
import type { BankRow } from './store.ts'
import { quoteAt } from './text.ts'

interface Heading {
  /** Where the heading line starts in the chunk's text. */
  start: number
  /** Just past the heading line. */
  end: number
  /** How many # it has: one more than its section's depth, up to 6, as the chunker writes it. */
  level: number
  title: string
}

const HEADING = /^(#{1,6}) (.+)$/

/**
 * The heading lines of a chunk. A span starts at the headings before its block, each on its own
 * line and a blank line apart, so a heading is only ever read where a span starts, never in code.
 */
function headingsOf(chunk: Pick<BankChunk, 'text' | 'spans'>): Heading[] {
  const headings: Heading[] = []
  for (const [start, end] of chunk.spans) {
    let at = start
    while (at < end) {
      const lineEnd = chunk.text.indexOf('\n', at)
      const stop = lineEnd === -1 || lineEnd > end ? end : lineEnd
      const match = HEADING.exec(chunk.text.slice(at, stop))
      if (match === null) break
      headings.push({ start: at, end: stop, level: match[1]?.length ?? 1, title: match[2] ?? '' })
      at = stop + 2
    }
  }
  return headings
}

/**
 * Each heading's fragment, when the chunk's fragments line up with its headings. The chunker
 * records the fragment of the section the chunk starts in, then each heading's, leaving out empty
 * and repeated ones, so a chunk that starts at a heading records that one once. When they do not
 * line up, as on pages whose subheadings have no fragment, there is none to give.
 */
function headingAnchors(chunk: BankChunk, headings: readonly Heading[]): string[] | undefined {
  const skip = chunk.anchors.length - headings.length
  if (skip !== 0 && skip !== 1) return undefined
  if (chunk.anchor === '') return skip === 0 ? chunk.anchors : undefined
  if (chunk.anchors[0] !== chunk.anchor) return undefined
  const startsAtHeading = headings[0] !== undefined && headings[0].start === chunk.spans[0]?.[0]
  // With none left out, the chunk's own fragment is its first heading's.
  if (skip === 0 && !startsAtHeading) return undefined
  return chunk.anchors.slice(skip)
}

/** The section a position of a chunk's text is in: its link and its headings. */
export function sectionCitation(
  document: Pick<BankDocument, 'url'>,
  chunk: BankChunk,
  offset: number,
): Pick<QuestionCitation, 'url' | 'sectionPath'> {
  const start = { url: citationUrl(document, chunk), sectionPath: chunk.sectionPath }
  const headings = headingsOf(chunk)
  const index = headings.findLastIndex((heading) => heading.start <= offset)
  if (index === -1) return start
  const anchor = headingAnchors(chunk, headings)?.[index]
  if (anchor === undefined) return start
  let sectionPath = chunk.sectionPath
  for (const heading of headings.slice(0, index + 1)) {
    sectionPath = [...sectionPath.slice(0, Math.max(0, heading.level - 2)), heading.title]
  }
  return { url: citationUrl(document, { anchor }), sectionPath }
}

/**
 * What a generated question's card shows of the docs: the section of its chunk the quote is in,
 * from past its heading to the next heading, one block per span, with the blocks the quote is in
 * marked. The checker read the whole chunk, but this is the part the card's link opens. Undefined
 * when the quote is not found.
 */
export function quotePassage(
  chunk: Pick<BankChunk, 'text' | 'spans'>,
  quote: string,
): QuestionPassage | undefined {
  const at = quoteAt(quote, chunk.text)
  if (at === undefined) return undefined
  const headings = headingsOf(chunk)
  const index = headings.findLastIndex((heading) => heading.start <= at.start)
  const start = headings[index]?.end ?? 0
  const end = headings[index + 1]?.start ?? chunk.text.length
  const blocks = chunk.spans.flatMap(([spanStart, spanEnd]) => {
    const from = Math.max(spanStart, start)
    const to = Math.min(spanEnd, end)
    const text = from < to ? chunk.text.slice(from, to).trim() : ''
    return text === '' ? [] : [{ text, quote: from < at.end && at.start < to }]
  })
  return blocks.length === 0 ? undefined : { blocks }
}

/** The section a generated question's quote is in, or the chunk's own when the quote is not found. */
export function quoteCitation(
  document: Pick<BankDocument, 'url'>,
  chunk: BankChunk,
  quote: string,
): Pick<QuestionCitation, 'url' | 'sectionPath'> {
  const at = quoteAt(quote, chunk.text)
  return sectionCitation(document, chunk, at?.start ?? 0)
}

/**
 * Generated questions kept from earlier runs, each with the link of the section its quote is in,
 * from its chunk as the index has it: a bank written when a link was its chunk's first section is
 * put right by a run, with no call. Other rows, and a question whose chunk changed, stay as they are.
 */
export function withQuoteCitations(
  rows: readonly BankRow[],
  documents: readonly BankDocument[],
): BankRow[] {
  const chunks = new Map(
    documents.flatMap((document) =>
      document.chunks.map((chunk) => [chunk.id, { document, chunk }]),
    ),
  )
  return rows.map((row) => {
    if (row.row !== 'question' || row.question.quote === undefined) return row
    const found = chunks.get(row.question.citation.chunkId)
    if (found?.chunk.textHash !== row.textHash) return row
    const { url, sectionPath } = quoteCitation(found.document, found.chunk, row.question.quote)
    const { citation } = row.question
    return { ...row, question: { ...row.question, citation: { ...citation, url, sectionPath } } }
  })
}
