// Raw HTML in the TypeScript docs (background-reading boxes, <details>, the
// tsc options table) becomes plain text; comments disappear, and so do the
// sections they hide (TypeScript 5.0.md). Media-only HTML becomes ''.
const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16))
    }
    if (entity.startsWith('#')) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10))
    return ENTITIES[entity.toLowerCase()] ?? match
  })
}

const BLOCK_END =
  /<\/(?:p|div|tr|li|h[1-6]|blockquote|details|summary|table|thead|tbody|ul|ol|aside|dd|dt)\s*>/gi

/** Whether the block is one comment and nothing else (a second comment after visible HTML is not). */
export function isHtmlComment(html: string): boolean {
  return /^\s*<!--(?:(?!-->)[\s\S])*-->\s*$/.test(html)
}

const ROW = /<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi
const CELL = /<(t[dh])\b[^>]*>([\s\S]*?)<\/\1\s*>/gi

// Inline tags vanish without a trace, so "<a>strict</a>;" stays "strict;"; any
// other tag becomes a space, so words in separate paragraphs of a cell stay apart.
const INLINE_TAG = /<\/?(?:a|abbr|b|code|em|i|kbd|small|span|strong|sub|sup)\b[^>]*>/gi
const stripTags = (html: string): string => html.replace(INLINE_TAG, '').replace(/<[^>]*>/g, ' ')
const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim()

/** Inline text with code marked by backticks, on one line. Entities stay encoded. */
function inlineText(html: string): string {
  return collapse(
    stripTags(
      html.replace(
        /<code[^>]*>([\s\S]*?)<\/code>/gi,
        (_match, inner: string) => `\`${collapse(stripTags(inner))}\``,
      ),
    ),
  )
}

// Marks converted rows until the end, so consecutive rows stay on consecutive lines.
const ROW_MARK = String.fromCharCode(2)
const BETWEEN_ROWS = new RegExp(`^(${ROW_MARK}.*)\\n+(?=${ROW_MARK})`, 'gm')

/** Each table row on its own line, cells joined by " | ". */
function rowsToLines(html: string): string {
  return html.replace(ROW, (_match, row: string) => {
    const cells = [...row.matchAll(CELL)].map((cell) => inlineText(cell[2] ?? ''))
    return `\n${ROW_MARK}${cells.join(' | ')}\n`
  })
}

export function htmlToText(html: string): string {
  const text = rowsToLines(html.replace(/<!--[\s\S]*?-->/g, ''))
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_match, inner: string) => `\`${inner}\``)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(BLOCK_END, '\n')
    // Cells outside a complete row (a table split by markdown) just become text.
    .replace(/<\/t[dh]\s*>/gi, ' ')
    .replace(/<[^>]*>/g, '')
  return decodeEntities(text)
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(BETWEEN_ROWS, '$1\n')
    .replaceAll(ROW_MARK, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
