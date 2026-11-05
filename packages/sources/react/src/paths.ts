// Which react.dev files are indexed, what kind of document each one is, and its
// page on the site (SPEC section 8). Paths are relative to the repository root.
import type { DocType } from '@docs-rag-lab/source-kit'

/** Include directory, in sparse-checkout form, and the doc type of everything under it. */
export const INCLUDES: readonly { dir: string; docType: DocType }[] = [
  { dir: 'src/content/learn', docType: 'handbook' },
  { dir: 'src/content/reference', docType: 'reference' },
]

// A test of the site's RSC sandbox, not a page: no sidebar lists it, and its URL is a 404.
const EXCLUDED = ['src/content/learn/rsc-sandbox-test.md']

function includeOf(path: string): { dir: string; docType: DocType } | undefined {
  return INCLUDES.find((include) => path.startsWith(`${include.dir}/`))
}

export function matchPath(path: string): boolean {
  return path.endsWith('.md') && !EXCLUDED.includes(path) && includeOf(path) !== undefined
}

export function docTypeOf(path: string): DocType {
  const include = includeOf(path)
  if (include === undefined) throw new Error(`not an indexed path: ${path}`)
  return include.docType
}

const CONTENT = 'src/content/'
const SITE = 'https://react.dev'

/** The page's URL: its path under src/content, with an index file standing for its folder. */
export function pageUrl(path: string): string {
  if (!path.startsWith(CONTENT)) throw new Error(`not an indexed path: ${path}`)
  const page = path
    .slice(CONTENT.length)
    .replace(/\.md$/, '')
    .replace(/\/index$/, '')
  return `${SITE}/${page}`
}
