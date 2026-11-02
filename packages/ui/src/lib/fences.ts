// Fenced code blocks, a line at a time. Only the same character, at least as long,
// at most 3 spaces deeper, with nothing after it closes a block. So a ```ts line
// inside a block is code, and so is a 3-tick line inside a 4-tick block. A block can
// sit in a quote or a list, and ends with the quote or the list item it opened on.
//
// This is no document tree, so an odd shape can still read differently from CommonMark:
// a fence indented as code, or an unindented closer for a block further into a list.
// On the index and the recorded answers it agrees with a parser on every line.

export interface OpenFence {
  /** The line it opens on. */
  line: number
  /** A line that closes it, with the same indentation and quote marks. */
  closer: string
}

export interface FenceScan {
  /** For each line, whether it is part of a code block, its fences included. */
  inCode: boolean[]
  /** The block still open after the last line. */
  open: OpenFence | undefined
}

interface Block extends OpenFence {
  marker: string
  /** It opened on a line like "- ```", so it ends with that list item. */
  onListMarker: boolean
}

// What can come before an opening fence: indentation, quote marks and list markers.
const PREFIX = /^[ \t]*(?:(?:>|[-*+](?=[ \t])|\d{1,9}[.)](?=[ \t]))[ \t]*)*/
// A backtick in the info string makes the line inline code, not a fence.
const OPENING = /^(?:(`{3,})[^`]*|(~{3,}).*)$/
const LIST_MARKER = /[-*+]|\d{1,9}[.)]/g

function quoteMarks(line: string): number {
  return /^[ \t>]*/.exec(line)?.[0].match(/>/g)?.length ?? 0
}

function withoutQuotes(line: string, quotes: number): string {
  let rest = line
  for (let i = 0; i < quotes; i += 1) rest = rest.replace(/^ {0,3}> ?/, '')
  return rest
}

function indentOf(text: string): number {
  return /^[ \t]*/.exec(text)?.[0].replaceAll('\t', '    ').length ?? 0
}

/** What a line does to a block that is open. */
function nextInBlock(line: string, block: Block): 'code' | 'closed' | 'ended' {
  const quotes = quoteMarks(block.closer)
  if (quoteMarks(line) < quotes) return 'ended'
  const body = withoutQuotes(line, quotes)
  const text = body.trim()
  const indent = indentOf(body)
  const base = indentOf(withoutQuotes(block.closer, quotes))
  if (block.onListMarker && text !== '' && indent < base) return 'ended'
  const closes =
    indent - base < 4 &&
    text.length >= block.marker.length &&
    text === (block.marker[0] ?? '').repeat(text.length)
  return closes ? 'closed' : 'code'
}

export function scanFences(lines: readonly string[]): FenceScan {
  const inCode: boolean[] = []
  let open: Block | undefined
  for (const [index, line] of lines.entries()) {
    if (open !== undefined) {
      const next = nextInBlock(line, open)
      if (next !== 'ended') {
        inCode.push(true)
        if (next === 'closed') open = undefined
        continue
      }
      // The line that ended the block may open another one.
      open = undefined
    }
    const prefix = PREFIX.exec(line)?.[0] ?? ''
    const match = OPENING.exec(line.slice(prefix.length).trimEnd())
    const marker = match?.[1] ?? match?.[2]
    inCode.push(marker !== undefined)
    if (marker === undefined) continue
    const indent = prefix.replace(LIST_MARKER, (item) => ' '.repeat(item.length))
    open = { line: index, closer: indent + marker, marker, onListMarker: indent !== prefix }
  }
  return { inCode, open: open && { line: open.line, closer: open.closer } }
}
