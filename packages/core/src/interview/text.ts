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

const SINGLE = new Set([String.fromCodePoint(0x2018), String.fromCodePoint(0x2019)])
const DOUBLE = new Set([String.fromCodePoint(0x201c), String.fromCodePoint(0x201d)])
const DASH = new Set([String.fromCodePoint(0x2013), String.fromCodePoint(0x2014)])

/**
 * A text in quoteForm, character by character, with the offset in the text each character of the
 * form comes from. It gives the same form as quoteForm.
 */
function quoteFormWithOffsets(text: string): { form: string; offsets: number[] } {
  let form = ''
  const offsets: number[] = []
  let space = false
  for (let i = 0; i < text.length; i++) {
    let char = text.charAt(i)
    if (char === '`' || char === '*' || char === '_') continue
    if (/\s/.test(char)) {
      // Spaces collapse, and the form starts with none.
      if (!space && form !== '') {
        form += ' '
        offsets.push(i)
      }
      space = true
      continue
    }
    space = false
    if (DASH.has(char)) char = '-'
    else if (SINGLE.has(char)) char = "'"
    else if (DOUBLE.has(char)) char = '"'
    form += char
    offsets.push(i)
  }
  if (form.endsWith(' ')) {
    form = form.slice(0, -1)
    offsets.pop()
  }
  return { form, offsets }
}

/**
 * Where a generated question's quote is in its chunk's text, as the quote check finds it: the
 * offsets of its first character and just past its last. Undefined when the check would fail.
 */
export function quoteAt(quote: string, text: string): { start: number; end: number } | undefined {
  const wanted = quoteForm(quote)
  if (wanted.length < MIN_QUOTE_LENGTH) return undefined
  const { form, offsets } = quoteFormWithOffsets(text)
  const at = form.indexOf(wanted)
  const first = offsets[at]
  const last = offsets[at + wanted.length - 1]
  return at === -1 || first === undefined || last === undefined
    ? undefined
    : { start: first, end: last + 1 }
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
