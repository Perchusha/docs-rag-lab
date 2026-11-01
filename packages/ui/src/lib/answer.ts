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

/** Whether the text ends with a fence that closes a code block. */
function endsWithClosingFence(text: string): boolean {
  const lines = text.split('\n')
  const last = lines.at(-1) ?? ''
  if (!CLOSING_FENCE.test(last)) return false
  // An even number of fence lines: the last one closes a block, it does not open one.
  return lines.filter((line) => FENCE.test(line)).length % 2 === 0
}

/**
 * The answer as markdown. Each marker becomes a link to #cite-<n>, which the
 * renderer turns into a citation button. A marker goes right after the text
 * of its block, before any trailing whitespace, so it stays on the cited
 * line instead of starting a paragraph of its own. After a closing code
 * fence it starts its own line: text after a closing fence would keep the
 * block open and turn the rest of the answer into code.
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
    markdown = endsWithClosingFence(body)
      ? `${body}\n\n${links}${trailing}`
      : body + links + trailing
  }
  return markdown
}
