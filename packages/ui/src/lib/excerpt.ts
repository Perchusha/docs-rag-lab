// Cited excerpts can run long: a whole code example, for one. The preview is the
// start of the excerpt, cut so that it is still valid markdown: no empty code box, no
// table without its delimiter row, and no raw bracket or asterisk from a link or
// emphasis the cut went through.
import { isDelimiterRow } from './answer.ts'
import { scanFences } from './fences.ts'

/** Blank lines do not count: two headings and their gaps would use it all up. */
export const PREVIEW_LINES = 5
export const PREVIEW_CHARACTERS = 260
/** With less room than this, a line is left out rather than cut to a few words. */
const SHORTEST_CUT = 40

// An emphasis marker that opens at the start of a word.
const EMPHASIS = /(?<![\w*_\\])(\*{1,2}|_{1,2})(?=[^\s*_])/g
// Nothing but a list marker, and nothing worth a preview on its own.
const NO_WORDS = /^\s*(?:[-*+]|\d{1,9}[.)])?\s*$/

/** Code spans and link targets as plain letters, so markup inside them does not count. */
function withoutLiterals(text: string): string {
  return text
    .replace(/`[^`]*`/g, (span) => 'x'.repeat(span.length))
    .replace(/\]\([^)]*\)/g, (target) => `]${'x'.repeat(target.length - 1)}`)
}

/** Where a link, an image or emphasis left open by the cut starts, and how long its opening is. */
function openInline(text: string): { index: number; length: number } | undefined {
  const plain = withoutLiterals(text)
  const bracket = plain.lastIndexOf('[')
  if (bracket !== -1) {
    // number[] and [text][1] are closed; only a target can still be open.
    const after = plain.slice(bracket)
    if (!after.includes(']') || after.includes('](')) {
      return plain[bracket - 1] === '!'
        ? { index: bracket - 1, length: 2 }
        : { index: bracket, length: 1 }
    }
  }
  for (const match of [...plain.matchAll(EMPHASIS)].reverse()) {
    const marker = match[1] ?? ''
    if (!plain.slice(match.index + marker.length).includes(marker)) {
      return { index: match.index, length: marker.length }
    }
  }
  return undefined
}

/** A line of prose cut at a word, ending with no markup left open. */
function cutProse(line: string, room: number): string {
  const cut = line.slice(0, room)
  const word = cut.lastIndexOf(' ')
  let kept = word > 0 && !NO_WORDS.test(cut.slice(0, word)) ? cut.slice(0, word) : cut
  for (let open = openInline(kept); open !== undefined; open = openInline(kept)) {
    const before = kept.slice(0, open.index)
    // With nothing to go back to, the opening goes and the words stay.
    kept = NO_WORDS.test(before) ? before + kept.slice(open.index + open.length) : before.trimEnd()
  }
  const inCodeSpan = (kept.match(/`/g)?.length ?? 0) % 2 === 1
  return `${kept}${inCodeSpan ? '`' : ''}...`
}

/** The start of an excerpt to show collapsed, or undefined if it is short enough to show whole. */
export function excerptPreview(text: string): string | undefined {
  const trimmed = text.trim()
  const lines = trimmed.split('\n')
  const count = (from: readonly string[]) => from.filter((line) => line.trim() !== '').length
  if (count(lines) <= PREVIEW_LINES && trimmed.length <= PREVIEW_CHARACTERS) return undefined

  const kept: string[] = []
  let room = PREVIEW_CHARACTERS
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (count(kept) >= PREVIEW_LINES) break
    const open = scanFences(kept).open
    const delimiter = lines[index + 1]
    if (open === undefined && delimiter !== undefined && isDelimiterRow(delimiter)) {
      // A table needs its first two rows whole: without them it is raw pipes.
      const size = line.length + delimiter.length + 1
      const fits = size < room && count(kept) + 2 <= PREVIEW_LINES
      if (!fits && kept.length > 0) break
      kept.push(line, delimiter)
      room -= size + 1
      index += 1
      continue
    }
    if (line.length >= room) {
      // Code is left whole, unless a block would otherwise show no line at all.
      if (open === undefined && (room >= SHORTEST_CUT || kept.length === 0)) {
        kept.push(cutProse(line, room))
      } else if (open?.line === kept.length - 1 && room >= SHORTEST_CUT) {
        kept.push(`${line.slice(0, room)}...`)
      }
      break
    }
    kept.push(line)
    room -= line.length + 1
  }

  const open = scanFences(kept).open
  if (open?.line === kept.length - 1) {
    // Cut right after the opening fence: an empty code box says nothing.
    kept.pop()
  } else if (open !== undefined) {
    // Cut inside a code block: close it again, or the rest would not render as code.
    kept.push(open.closer)
  }
  const preview = kept.join('\n').trimEnd()
  return preview === trimmed || preview === '' ? undefined : preview
}
