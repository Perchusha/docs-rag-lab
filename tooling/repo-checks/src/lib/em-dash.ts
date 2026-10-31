// CLAUDE.md and SPEC section 14: never use em dashes, use plain hyphens.
// Built from its code point so this file passes its own check.
export const EM_DASH = String.fromCodePoint(0x2014)

export interface Hit {
  line: number
  col: number
}

/** Returns the 1-based line and column of every em dash in `text`. */
export function findEmDashes(text: string): Hit[] {
  const hits: Hit[] = []
  text.split(/\r?\n/).forEach((line, index) => {
    let col = line.indexOf(EM_DASH)
    while (col !== -1) {
      hits.push({ line: index + 1, col: col + 1 })
      col = line.indexOf(EM_DASH, col + 1)
    }
  })
  return hits
}

// The lockfile is generated, and fixtures must stay byte-for-byte copies of
// their upstream docs.
const EXCLUDED = [/(^|\/)pnpm-lock\.yaml$/, /(^|\/)__fixtures__\//]

/** Whether a repository-relative path is subject to the check. */
export function isChecked(path: string): boolean {
  const normalized = path.replaceAll('\\', '/')
  return !EXCLUDED.some((pattern) => pattern.test(normalized))
}

/** Treats a file as binary when its first 8 KB contain a NUL byte. */
export function isBinary(content: Uint8Array): boolean {
  return content.subarray(0, 8192).includes(0)
}
