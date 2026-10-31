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
  /**
   * Bump when `parse` gives different output for the same file. It is stored
   * in the manifest, and a change forces a full re-parse (no re-embedding of
   * unchanged chunk text).
   */
  parserVersion: number
  match(path: string): boolean
  parse(file: SourceFile, ctx: ParseContext): Promise<ParsedDoc>
  /**
   * Tokens in a question that keyword search should match exactly, in the
   * form this source's docs use them. TypeScript: `TS2345` is written `2345`
   * in `// @errors:` directives. Generic tokens (backticks, camelCase) are
   * found by core.
   */
  exactTokens?(question: string): string[]
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
