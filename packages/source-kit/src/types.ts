// The source plugin contract (SPEC section 7). A source only knows how to parse
// its own format; sync, diffing, hashing and chunking live in source-kit.

/** Coarse document kinds, shared by every source so retrieval and eval can filter by them. */
export type DocType = 'handbook' | 'reference' | 'option' | 'release-notes' | 'other'

export const DOC_TYPES: readonly DocType[] = [
  'handbook',
  'reference',
  'option',
  'release-notes',
  'other',
]

export interface License {
  name: string
  url: string
  attribution: string
}

/** A file from the source repository: repo-relative POSIX path, LF line endings. */
export interface SourceFile {
  path: string
  content: string
}

export interface ParseContext {
  /** The upstream commit being parsed, when known. */
  commitSha: string | undefined
}

export interface Source {
  id: string
  repo: string
  branch: string
  /** Sparse-checkout directories, relative to the repository root. */
  include: string[]
  license: License
  match(path: string): boolean
  parse(file: SourceFile, ctx: ParseContext): Promise<ParsedDoc>
}

export interface ParsedDoc {
  title: string
  /** Canonical public URL used in citations. */
  url: string
  docType: DocType
  sections: Section[]
  metadata: Record<string, unknown>
}

/**
 * One heading and the blocks under it, in document order. `headingPath` holds
 * the headings from the top of the document down to this one (the document
 * title is not part of it); content before the first heading has an empty path.
 */
export interface Section {
  headingPath: string[]
  /** URL fragment of this section's heading, '' for none. */
  anchor: string
  blocks: Block[]
}

export type Block =
  | { kind: 'prose'; text: string }
  | { kind: 'code'; lang: string; code: string }
  | { kind: 'callout'; variant: string; blocks: Block[] }
