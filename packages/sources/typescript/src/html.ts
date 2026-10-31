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

export function isHtmlComment(html: string): boolean {
  return /^\s*<!--[\s\S]*-->\s*$/.test(html)
}

export function htmlToText(html: string): string {
  const text = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_match, inner: string) => `\`${inner}\``)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(BLOCK_END, '\n')
    .replace(/<\/t[dh]\s*>/gi, ' ')
    .replace(/<[^>]*>/g, '')
  return decodeEntities(text)
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
