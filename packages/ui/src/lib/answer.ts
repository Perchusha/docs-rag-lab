// The streamed answer as data: text deltas and citation markers in the order
// they arrived (AnswerEvent, ADR-0006), and the markdown that renders them.
import { scanFences } from './fences.ts'

export type AnswerPart = { kind: 'text'; text: string } | { kind: 'cite'; numbers: number[] }

/** Appends a text delta, merged into the last part when that is text too. */
export function appendText(parts: readonly AnswerPart[], text: string): AnswerPart[] {
  const last = parts.at(-1)
  if (last?.kind === 'text')
    return [...parts.slice(0, -1), { kind: 'text', text: last.text + text }]
  return [...parts, { kind: 'text', text }]
}

/** Appends the markers of a text block that has just ended. */
export function appendCitations(parts: readonly AnswerPart[], numbers: number[]): AnswerPart[] {
  return numbers.length === 0 ? [...parts] : [...parts, { kind: 'cite', numbers }]
}

/** The prefix of a citation link's URL; the citation number follows it. */
export const CITE_HREF = '#cite-'

/** The citation number of a link the answer markdown made, or undefined for any other link. */
export function citationNumber(href: string | undefined): number | undefined {
  if (href?.startsWith(CITE_HREF) !== true) return undefined
  const rest = href.slice(CITE_HREF.length)
  return /^[1-9]\d*$/.test(rest) ? Number(rest) : undefined
}

// A thematic break, or the underline that makes the line above it a heading. A
// marker on one would turn it into text, so the line above takes the marker.
const RULE_LINE = /^ {0,3}(?:=+|-+|(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})[ \t]*$/

// The last pipe of a table row, and any space around it; an escaped pipe is text.
const ROW_END = /[ \t]*(?<!\\)\|[ \t]*$/
// A table's delimiter row, such as | --- | :-: |.
const DELIMITER_ROW = /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/

function isRow(line: string): boolean {
  return ROW_END.test(line) && line.replace(ROW_END, '').includes('|')
}

function isDelimiterRow(line: string): boolean {
  return line.includes('|') && DELIMITER_ROW.test(line)
}

/** The last line of text before the code blocks that end the text, or -1 if there is none. */
function lineBeforeCode(lines: readonly string[], inCode: readonly boolean[]): number {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i] ?? ''
    if (inCode[i] !== true && line.trim() !== '' && !RULE_LINE.test(line)) return i
  }
  return -1
}

/** The lines with the markers at the end of one of them. */
function markLine(lines: string[], index: number, links: string): string {
  const line = lines[index] ?? ''
  // A marker after a row's last pipe would be an extra cell, which GFM drops
  // without a trace. It goes inside the last cell; a delimiter row has no cell
  // to hold it, so it goes in the header row above.
  const rowIndex = isDelimiterRow(line) ? index - 1 : index
  const row = lines[rowIndex]
  if (row !== undefined && isRow(row)) lines[rowIndex] = row.replace(ROW_END, () => `${links} |`)
  else lines[index] = line.trimEnd() + links
  return lines.join('\n')
}

/** The text with the markers placed where they will render. */
function withMarkers(body: string, links: string): string {
  const lines = body.split('\n')
  const { inCode, open } = scanFences(lines)
  if (inCode.at(-1) !== true) return markLine(lines, lines.length - 1, links)
  // In or right after a code block, a marker would be text in the code, or text
  // that keeps the block open and turns the rest of the answer into code. On a
  // line of its own it reads as a lone number. So it goes on the text before.
  const before = lineBeforeCode(lines, inCode)
  if (before !== -1) return markLine(lines, before, links)
  // No text before: its own line after the block, or before one still open.
  return open === undefined ? `${body}\n\n${links}` : `${links}\n\n${body}`
}

/**
 * The answer as markdown. Each marker becomes a link to #cite-<n>, which the
 * renderer turns into a citation button. A marker goes right after the text
 * of its block, before any trailing whitespace, so it stays on the cited
 * line instead of starting a paragraph of its own.
 */
export function answerMarkdown(parts: readonly AnswerPart[]): string {
  let markdown = ''
  for (const part of parts) {
    if (part.kind === 'text') {
      markdown += part.text
      continue
    }
    const body = markdown.trimEnd()
    const trailing = markdown.slice(body.length)
    const links = part.numbers.map((n) => `[${String(n)}](${CITE_HREF}${String(n)})`).join('')
    markdown = withMarkers(body, links) + trailing
  }
  return markdown
}
