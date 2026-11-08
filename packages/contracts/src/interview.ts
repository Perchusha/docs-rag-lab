// The interview-prep app's question bank (ADR-0018): what core writes to interview/bank/ and what
// the app shows. Compiler questions take their answer from the compiler's output stored at
// ingest. Generated questions were written from one chunk and checked against it.

export const QUESTION_KINDS = ['compiler-error', 'compiler-type', 'pitfall', 'theory'] as const
export type QuestionKind = (typeof QUESTION_KINDS)[number]

/** Who stands behind a question's answer: the compiler, or the checker that read its chunk. */
export type VerifiedBy = 'compiler' | 'checker'

/** Where a question's answer is in the docs. */
export interface QuestionCitation {
  /** The page, with the anchor of the section the chunk starts in when it has one. */
  url: string
  /** The document's title. */
  title: string
  /** The headings of the section the chunk starts in. */
  sectionPath: string[]
  docPath: string
  chunkId: string
}

/** Code shown with a question, always from the docs and never written by a model. */
export interface QuestionCode {
  lang: string
  /** As the docs site shows it. */
  code: string
  /**
   * What the site hides of the example, such as the declarations the code uses, shown on demand:
   * without it, "does this compile?" would be unfair (ADR-0018). Absent when nothing is hidden.
   */
  setup?: string
  /** The compiler ran on this example (ADR-0017). */
  compiled: boolean
}

/** What the compiler said of an example, which is a compiler question's answer. */
export interface CompilerAnswer {
  /** The compiler and its versions, as the compiled index names them. */
  compiler: string
  errors: { code: number; line: string; text: string }[]
  queries: { target: string; line: string; text: string }[]
}

export interface BankQuestion {
  /** Stable while its chunk's text and the bank's prompts stay the same. */
  id: string
  source: string
  kind: QuestionKind
  /** The topic's ID within its source. */
  topicId: string
  prompt: string
  code?: QuestionCode
  /** The expected answer, as text. A compiler question's is the compiler's output, written out. */
  answer: string
  /** A generated question's supporting quote from its chunk, found there by code. */
  quote?: string
  /** A compiler question's answer as the compiler gave it. */
  compiler?: CompilerAnswer
  citation: QuestionCitation
  verifiedBy: VerifiedBy
}

/** A topic of the topic map: a page, or pages taken together, within a group such as Handbook. */
export interface BankTopic {
  source: string
  id: string
  title: string
  group: string
}
