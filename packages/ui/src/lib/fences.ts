// Fenced code blocks, line by line, as CommonMark reads them. Only the same
// character, at least as long, with nothing after it closes a block. So a ```ts
// line inside a block is code, and so is a 3-tick line inside a 4-tick block.

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

// What can come before an opening fence: indentation, quote marks and list markers.
const PREFIX = /^[ \t]*(?:(?:>|[-*+](?=[ \t])|\d{1,9}[.)](?=[ \t]))[ \t]*)*/
// A backtick in the info string makes the line inline code, not a fence.
const OPENING = /^(?:(`{3,})[^`]*|(~{3,}).*)$/
const LIST_MARKER = /[-*+]|\d{1,9}[.)]/g

function closes(line: string, opening: string): boolean {
  // Quote marks count only for a block that opened in a quote.
  const body = line.replace(opening.includes('>') ? /^[ \t>]*/ : /^[ \t]*/, '').trimEnd()
  const marker = opening.trimStart().replace(/^[ \t>]*/, '')
  return body.length >= marker.length && body === (marker[0] ?? '').repeat(body.length)
}

export function scanFences(lines: readonly string[]): FenceScan {
  const inCode: boolean[] = []
  let open: OpenFence | undefined
  for (const [index, line] of lines.entries()) {
    if (open !== undefined) {
      inCode.push(true)
      if (closes(line, open.closer)) open = undefined
      continue
    }
    const prefix = PREFIX.exec(line)?.[0] ?? ''
    const match = OPENING.exec(line.slice(prefix.length))
    const marker = match?.[1] ?? match?.[2]
    inCode.push(marker !== undefined)
    if (marker === undefined) continue
    const indent = prefix.replace(LIST_MARKER, (item) => ' '.repeat(item.length))
    open = { line: index, closer: indent + marker }
  }
  return { inCode, open }
}
