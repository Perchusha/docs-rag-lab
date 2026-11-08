// Text checks of the interview bank (ADR-0018): the quote check, the dash the repository never
// holds, and the callouts of a chunk.

/** The repository holds no em dash in any text (CLAUDE.md), and the bank is committed. */
const EM_DASH = new RegExp(String.fromCodePoint(0x2014), 'g')
const DASHES = new RegExp(`[${String.fromCodePoint(0x2013)}${String.fromCodePoint(0x2014)}]`, 'g')
const SINGLE_QUOTES = new RegExp(
  `[${String.fromCodePoint(0x2018)}${String.fromCodePoint(0x2019)}]`,
  'g',
)
const DOUBLE_QUOTES = new RegExp(
  `[${String.fromCodePoint(0x201c)}${String.fromCodePoint(0x201d)}]`,
  'g',
)

/** Text for the bank: each em dash becomes a hyphen, as the contexts of M5 had it. */
export function withoutEmDash(text: string): string {
  return text.replace(EM_DASH, '-')
}

/** What the quote check compares: no markdown emphasis or backticks, plain dashes and quotes, one space. */
export function quoteForm(text: string): string {
  return text
    .replace(DASHES, '-')
    .replace(SINGLE_QUOTES, "'")
    .replace(DOUBLE_QUOTES, '"')
    .replace(/[`*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** A quote shorter than this could be found almost anywhere, so it supports nothing. */
export const MIN_QUOTE_LENGTH = 20

/** Whether a generated question's quote is in its chunk's text. */
export function quoteFound(quote: string, text: string): boolean {
  const wanted = quoteForm(quote)
  return wanted.length >= MIN_QUOTE_LENGTH && quoteForm(text).includes(wanted)
}

/**
 * The callouts of one kind in a chunk, such as React's Pitfall boxes, from the chunk's spans:
 * each block is one span, and a callout renders as its label in brackets, then its blocks.
 */
export function calloutsOf(
  text: string,
  spans: readonly [number, number][],
  variant: string,
): string[] {
  const label = `[${variant}]`
  return spans.flatMap(([start, end]) => {
    const block = text.slice(start, end)
    // A span starts at the heading before its block, when there is one.
    const at = block.search(/^\[/m)
    if (at === -1) return []
    const head = block.slice(0, at)
    const onlyHeadings = head
      .split('\n')
      .every((line) => line.trim() === '' || line.startsWith('#'))
    return onlyHeadings && block.startsWith(label, at) ? [block.slice(at)] : []
  })
}
