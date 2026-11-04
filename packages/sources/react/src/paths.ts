// Which react files are indexed, and what kind of document each one is (SPEC
// section 8). Paths are relative to the repository root.
import type { DocType } from '@docs-rag-lab/source-kit'

/** Include directory, in sparse-checkout form, and the doc type of everything under it. */
export const INCLUDES: readonly { dir: string; docType: DocType }[] = [
  { dir: 'src/content/learn', docType: 'handbook' },
  { dir: 'src/content/reference', docType: 'reference' },
]

function includeOf(path: string): { dir: string; docType: DocType } | undefined {
  return INCLUDES.find((include) => path.startsWith(`${include.dir}/`))
}

export function matchPath(path: string): boolean {
  return /\.mdx?$/.test(path) && includeOf(path) !== undefined
}

export function docTypeOf(path: string): DocType {
  const include = includeOf(path)
  if (include === undefined) throw new Error(`not an indexed path: ${path}`)
  return include.docType
}
