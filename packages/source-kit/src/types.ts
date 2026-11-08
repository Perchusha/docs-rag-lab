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
  /**
   * The same source with its examples compiled, for an index of its own (ADR-0017). Only a source
   * whose docs have examples a compiler checks has one.
   */
  compiled?(options?: CompileOptions): CompiledSource
  /**
   * Where a document sits in the interview-prep app's topic map (ADR-0018), or undefined when the
   * question bank leaves it out. Only a source with a bank has this.
   */
  interviewTopic?(document: InterviewDocument): InterviewTopic | undefined
  /**
   * A code block as the docs site shows it, without the markup that would give an interview
   * question's answer away, and what the site hides of it. TypeScript: the twoslash directives
   * come out, and what `---cut---` hides is the setup.
   */
  displayCode?(code: string): DisplayedCode
}

/** A code block as the site shows it, and the setup the site hides, such as declarations. */
export interface DisplayedCode {
  code: string
  /** '' when the site hides nothing. */
  setup: string
}

/** What a source reads to place a document in the topic map. */
export interface InterviewDocument {
  path: string
  docType: DocType
  title: string
}

/** A topic of the topic map, within a group such as a section of the docs. */
export interface InterviewTopic {
  /** Unique within the source, stable across syncs. */
  id: string
  title: string
  /** The section the topic is listed under, such as `Handbook`. */
  group: string
}

/** A source whose code blocks carry what a compiler said of them. */
export interface CompiledSource extends Source {
  /** The compiler and its versions, as the compiled index's manifest names them. */
  compiler: string
}

export interface CompileOptions {
  /** Called once for every example the compiler ran on, whether it compiled or not. */
  onResult?: (result: CompileResult) => void
}

/** One example the compiler ran on. */
export interface CompileResult {
  path: string
  /** Its place among the file's compiled examples, from 0. */
  index: number
  lang: string
  ok: boolean
  /** Why it did not compile, in one line, when it did not. */
  reason?: string
}

/**
 * What the compiler said of one example (ADR-0017): its errors and its type queries, each with the
 * line of the shown code it is on, and the emitted file when the example asks to show it.
 */
export interface CompilerOutput {
  errors: { code: number; line: string; text: string }[]
  queries: { target: string; line: string; text: string }[]
  emitted?: { name: string; lang: string; code: string }
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
  | { kind: 'code'; lang: string; code: string; compiled?: CompilerOutput }
  | { kind: 'callout'; variant: string; blocks: Block[] }
