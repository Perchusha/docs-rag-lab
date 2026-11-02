// Cited excerpts can run long: a whole code example, for one. The preview is the
// start of the excerpt, cut so that it is still valid markdown.

// A code fence line: up to 3 spaces, then 3 or more backticks or tildes.
const FENCE = /^ {0,3}(`{3,}|~{3,})/

export const PREVIEW_LINES = 5
export const PREVIEW_CHARACTERS = 260

/** A single long line, cut at a word, with an open code span closed again. */
function cutLine(line: string): string {
  const cut = line.slice(0, PREVIEW_CHARACTERS)
  const word = cut.lastIndexOf(' ')
  const kept = word > 0 ? cut.slice(0, word) : cut
  const open = (kept.match(/`/g)?.length ?? 0) % 2 === 1
  return `${kept}${open ? '`' : ''}...`
}

/** The start of an excerpt to show collapsed, or undefined if it is short enough to show whole. */
export function excerptPreview(text: string): string | undefined {
  const lines = text.trim().split('\n')
  if (lines.length <= PREVIEW_LINES && text.length <= PREVIEW_CHARACTERS) return undefined

  const kept: string[] = []
  let size = 0
  let fence: string | undefined
  for (const line of lines) {
    if (kept.length >= PREVIEW_LINES || size + line.length > PREVIEW_CHARACTERS) break
    const marker = FENCE.exec(line)?.[1]
    if (marker !== undefined) fence = fence === undefined ? marker : undefined
    kept.push(line)
    size += line.length + 1
  }
  if (kept.length === 0) return cutLine(lines[0] ?? '')
  // Cut inside a code block: close it again, or the rest would not render as code.
  if (fence !== undefined) kept.push(fence)
  return kept.join('\n').trimEnd()
}
