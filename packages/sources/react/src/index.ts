// Public entry of @docs-rag-lab/source-react: its plugin (SPEC section 7).
import type { ParsedDoc, Source, SourceFile } from '@docs-rag-lab/source-kit'

import { parseMdx } from './markdown.ts'
import { docTypeOf, INCLUDES, matchPath, pageUrl } from './paths.ts'

export { INCLUDES, matchPath } from './paths.ts'

export interface ReactSourceOptions {
  branch?: string
}

/**
 * Bump when parsing the same file gives different output: the next sync then
 * re-parses everything (the embedding cache keeps it free).
 */
export const PARSER_VERSION = 1

/**
 * What the site shows beside the title of a page with a `version`. It goes in the title, which
 * starts every chunk, so that a passage from the middle of such a page still says it (ADR-0016).
 */
const VERSION_LABELS: Readonly<Record<string, string>> = {
  canary: 'Canary',
  experimental: 'Experimental',
  rc: 'RC',
}

function stringOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/**
 * The frontmatter's title. Four pages of tags write `link: "<link>"` instead, and the site takes
 * their title from its sidebar, which gives the same text.
 */
function titleOf(path: string, frontmatter: Record<string, unknown>): string {
  const title = stringOf(frontmatter.title)
  if (title !== undefined) return title
  const tag = Object.entries(frontmatter).find(([key, value]) => value === `<${key}>`)
  if (tag === undefined) throw new Error(`${path}: frontmatter has no title`)
  return `<${tag[0]}>`
}

async function parseFile(file: SourceFile): Promise<ParsedDoc> {
  const { frontmatter, sections } = parseMdx(file.path, file.content)
  const title = titleOf(file.path, frontmatter)
  const version = stringOf(frontmatter.version)
  const metadata: Record<string, unknown> = {}
  let shown = title
  if (version !== undefined) {
    const label = VERSION_LABELS[version]
    if (label === undefined) throw new Error(`${file.path}: an unknown version: ${version}`)
    metadata.version = version
    shown = `${title} (${label})`
  }
  return Promise.resolve({
    title: shown,
    url: pageUrl(file.path),
    docType: docTypeOf(file.path),
    sections,
    metadata,
  })
}

export function reactSource(options: ReactSourceOptions = {}): Source {
  return {
    id: 'react',
    repo: 'https://github.com/reactjs/react.dev',
    branch: options.branch ?? 'main',
    include: INCLUDES.map((include) => include.dir),
    license: {
      name: 'CC BY 4.0',
      url: 'https://creativecommons.org/licenses/by/4.0/',
      attribution: 'React documentation, Copyright (c) Meta Platforms, Inc. and affiliates.',
    },
    parserVersion: PARSER_VERSION,
    match: matchPath,
    parse: parseFile,
  }
}
