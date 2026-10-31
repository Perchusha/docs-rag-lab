// Which TypeScript-Website files are indexed, and what kind of document each
// one is (SPEC section 8). Paths are relative to the repository root.
import type { DocType } from '@docs-rag-lab/source-kit'

const DOCS = 'packages/documentation/copy/en'
export const OPTIONS_DIR = 'packages/tsconfig-reference/copy/en/options'

/** Include directory, in sparse-checkout form, and the doc type of everything under it. */
export const INCLUDES: readonly { dir: string; docType: DocType }[] = [
  { dir: `${DOCS}/handbook-v2`, docType: 'handbook' },
  { dir: `${DOCS}/reference`, docType: 'reference' },
  { dir: `${DOCS}/modules-reference`, docType: 'reference' },
  { dir: `${DOCS}/declaration-files`, docType: 'other' },
  { dir: `${DOCS}/project-config`, docType: 'other' },
  { dir: `${DOCS}/javascript`, docType: 'other' },
  { dir: `${DOCS}/release-notes`, docType: 'release-notes' },
  { dir: OPTIONS_DIR, docType: 'option' },
]

// Mermaid sources for the modules-reference diagrams: no frontmatter, no page.
const EXCLUDED = [`${DOCS}/modules-reference/diagrams/`]

function includeOf(path: string): { dir: string; docType: DocType } | undefined {
  return INCLUDES.find((include) => path.startsWith(`${include.dir}/`))
}

export function matchPath(path: string): boolean {
  if (!path.endsWith('.md')) return false
  if (EXCLUDED.some((prefix) => path.startsWith(prefix))) return false
  return includeOf(path) !== undefined
}

export function docTypeOf(path: string): DocType {
  const include = includeOf(path)
  if (include === undefined) throw new Error(`not an indexed path: ${path}`)
  return include.docType
}

export function isOption(path: string): boolean {
  return path.startsWith(`${OPTIONS_DIR}/`)
}

const SITE = 'https://www.typescriptlang.org'

/**
 * The option name and canonical URL of a tsconfig option file. Each option has
 * its own page (case-sensitive), except the typeAcquisition sub-options, which
 * live as anchors on the tsconfig reference page.
 */
export function optionOf(path: string): { name: string; url: string } {
  const relative = path.slice(OPTIONS_DIR.length + 1).replace(/\.md$/, '')
  const [first, second] = relative.split('/')
  if (first === 'typeAcquisition' && second !== undefined) {
    return { name: second, url: `${SITE}/tsconfig/#type-${second}` }
  }
  if (first === undefined || second !== undefined)
    throw new Error(`unexpected option path: ${path}`)
  return { name: first, url: `${SITE}/tsconfig/${first}.html` }
}

/** A documentation page URL from its frontmatter permalink. */
export function permalinkUrl(path: string, permalink: unknown): string {
  if (typeof permalink !== 'string' || !permalink.startsWith('/')) {
    throw new Error(`${path}: frontmatter has no absolute permalink`)
  }
  return `${SITE}${permalink}`
}
