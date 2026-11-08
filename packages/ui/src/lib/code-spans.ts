// Inline code in a question's text (ADR-0018). Prompts, answers and quotes are plain text with
// markdown code spans, such as `typeof x`: a run of backticks opens one and the next run of the
// same length closes it, so code that holds a backtick is written with a longer run, as CommonMark
// has it. Nothing else of markdown is read.

export interface TextPart {
  code: boolean
  text: string
}

function runAt(text: string, at: number): number {
  let length = 0
  while (text[at + length] === '`') length++
  return length
}

/** Where the run of exactly `length` backticks after `from` starts, or -1. */
function closingRun(text: string, from: number, length: number): number {
  let at = text.indexOf('`', from)
  while (at !== -1) {
    const run = runAt(text, at)
    if (run === length) return at
    at = text.indexOf('`', at + run)
  }
  return -1
}

export function codeSpans(text: string): TextPart[] {
  const parts: TextPart[] = []
  let plain = ''
  let at = 0
  while (at < text.length) {
    if (text[at] !== '`') {
      plain += text[at] ?? ''
      at++
      continue
    }
    const length = runAt(text, at)
    const close = closingRun(text, at + length, length)
    if (close === -1) {
      plain += '`'.repeat(length)
      at += length
      continue
    }
    if (plain !== '') parts.push({ code: false, text: plain })
    plain = ''
    let inner = text.slice(at + length, close)
    // One space on each side is padding, so that code can start or end with a backtick.
    if (inner.length > 2 && inner.startsWith(' ') && inner.endsWith(' ') && inner.trim() !== '') {
      inner = inner.slice(1, -1)
    }
    parts.push({ code: true, text: inner })
    at = close + length
  }
  if (plain !== '') parts.push({ code: false, text: plain })
  return parts
}
