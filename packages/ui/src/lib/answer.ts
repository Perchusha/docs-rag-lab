// The streamed answer as data: text deltas and citation markers in the order
// they arrived (AnswerEvent, ADR-0006), and the markdown that renders them.

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

// A code fence line: up to 3 spaces, then 3 or more backticks or tildes.
const FENCE = /^ {0,3}(`{3,}|~{3,})/
// A closing fence has nothing after the fence but spaces.
const CLOSING_FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/

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
function lineBeforeCode(lines: readonly string[]): number {
  let inCode = false
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i] ?? ''
    if (FENCE.test(line)) inCode = !inCode
    else if (!inCode && line.trim() !== '') return i
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
  const fences = lines.filter((line) => FENCE.test(line)).length
  const last = lines.at(-1) ?? ''
  // After a closing fence, text would keep the block open and turn the rest of
  // the answer into code, and a line of its own reads as a lone marker. So it
  // goes on the text before the code. An even number of fence lines means the
  // last one closes a block.
  if (CLOSING_FENCE.test(last) && fences % 2 === 0) {
    const before = lineBeforeCode(lines)
    return before === -1 ? `${body}\n\n${links}` : markLine(lines, before, links)
  }
  // Inside a code block there is no better place than the end.
  if (fences % 2 === 1) return body + links
  return markLine(lines, lines.length - 1, links)
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
