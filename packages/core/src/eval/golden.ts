// Golden sets (SPEC section 10, ADR-0009): one JSONL file per source, written or
// reviewed by a human. This module reads and checks the file. It knows nothing
// about the index: anchors.ts resolves the anchors. A misspelled field or tag
// would silently change what gets measured, so anything unknown is refused.
import { sha256Hex } from '@docs-rag-lab/source-kit'

export const GOLDEN_TAGS = [
  'basic',
  'version',
  'edge',
  'fresh',
  'exact-token',
  'cross-lingual',
  'unanswerable',
] as const

export type GoldenTag = (typeof GOLDEN_TAGS)[number]

/** A place in the docs. In the file, a plain string is the same as `{ at }`. */
export interface AnchorRef {
  /** A repo-relative document path, optionally with `#` and a section anchor. */
  at: string
  /**
   * A literal passage the chunk must contain. A long section spans several
   * chunks and a match in the wrong one is not a hit, so this pins the part
   * that holds the answer.
   */
  contains?: string | undefined
}

export interface GoldenQuestion {
  id: string
  question: string
  /** What a correct answer says. The judge grades against this; it may hold more than was asked. */
  answer: string
  /** The passages the answer was written from. Empty for an unanswerable question. */
  primary: AnchorRef[]
  /** all: the answer needs every primary anchor. any: each one is enough on its own. */
  primaryMatch: 'all' | 'any'
  /** Other passages that also support the answer. Never required. */
  acceptable: AnchorRef[]
  tags: GoldenTag[]
  /** Why the question is graded this way, for whoever reviews it next. */
  note: string | undefined
}

/** A golden set or lock that cannot be used. The message lists every problem. */
export class GoldenSetError extends Error {
  readonly problems: readonly string[]

  constructor(problems: readonly string[]) {
    super(`the golden set cannot be used:\n${problems.map((p) => `  ${p}`).join('\n')}`)
    this.name = 'GoldenSetError'
    this.problems = problems
  }
}

/** A set file's identity, for the freeze (ADR-0009): the same with either line ending. */
export function goldenSetHash(text: string): string {
  return sha256Hex(text.replaceAll('\r\n', '\n'))
}

/** One anchor's identity: two pins on one section are two anchors. */
export function anchorKey(ref: AnchorRef): string {
  return ref.contains === undefined ? ref.at : `${ref.at} contains ${ref.contains}`
}

const FIELDS: ReadonlySet<string> = new Set([
  'id',
  'question',
  'answer',
  'primary',
  'primaryMatch',
  'acceptable',
  'tags',
  'note',
])
const ID = /^[a-z]+-\d{4}$/
// A path, then at most one fragment; neither may be empty.
const ANCHOR = /^[^#]+(#[^#]+)?$/

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function parseAnchor(value: unknown, report: (problem: string) => void): AnchorRef | undefined {
  const fields: Record<string, unknown> | undefined =
    typeof value === 'string'
      ? { at: value }
      : typeof value === 'object' && value !== null && !Array.isArray(value)
        ? { ...value }
        : undefined
  if (fields === undefined) {
    report(`an anchor must be a string or an object, got ${JSON.stringify(value)}`)
    return undefined
  }
  const unknown = Object.keys(fields).filter((key) => key !== 'at' && key !== 'contains')
  if (unknown.length > 0) report(`unknown anchor field "${unknown.join('", "')}"`)
  const { at, contains } = fields
  if (typeof at !== 'string' || !ANCHOR.test(at)) {
    report(`an anchor needs a path, optionally with #section, got ${JSON.stringify(at)}`)
    return undefined
  }
  if (contains !== undefined && !isText(contains)) {
    report(`"contains" must be a non-empty string in the anchor ${at}`)
    return undefined
  }
  return contains === undefined ? { at } : { at, contains }
}

function parseAnchors(
  value: unknown,
  name: string,
  report: (problem: string) => void,
): AnchorRef[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    report(`"${name}" must be an array`)
    return []
  }
  return value.flatMap((item) => parseAnchor(item, report) ?? [])
}

function parseTags(value: unknown, report: (problem: string) => void): GoldenTag[] {
  if (!Array.isArray(value) || value.length === 0) {
    report('"tags" must be a non-empty array')
    return []
  }
  const tags = value.flatMap((item): GoldenTag[] => {
    const tag = GOLDEN_TAGS.find((known) => known === item)
    if (tag === undefined) report(`unknown tag ${JSON.stringify(item)}`)
    return tag === undefined ? [] : [tag]
  })
  if (new Set(tags).size !== tags.length) report('a tag is listed twice')
  return tags
}

function parseQuestion(
  value: unknown,
  report: (problem: string) => void,
): GoldenQuestion | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    report('a question must be a JSON object')
    return undefined
  }
  const fields: Record<string, unknown> = { ...value }
  const unknown = Object.keys(fields).filter((key) => !FIELDS.has(key))
  if (unknown.length > 0) report(`unknown field "${unknown.join('", "')}"`)

  const { id, question, answer, primaryMatch, note } = fields
  if (typeof id !== 'string' || !ID.test(id)) {
    report(`"id" must look like ts-0001, got ${JSON.stringify(id)}`)
  }
  if (!isText(question)) report('"question" must be a non-empty string')
  if (!isText(answer)) report('"answer" must be a non-empty string')
  if (note !== undefined && !isText(note)) report('"note" must be a non-empty string')

  const primary = parseAnchors(fields.primary, 'primary', report)
  const acceptable = parseAnchors(fields.acceptable, 'acceptable', report)
  const tags = parseTags(fields.tags, report)

  // Counted as written, so a malformed anchor is reported once and not also as a missing one.
  const declared = Array.isArray(fields.primary) ? fields.primary.length : 0
  const malformed = fields.primary !== undefined && !Array.isArray(fields.primary)

  // Retrieval metrics need something to find, and an unanswerable question must have nothing.
  if (tags.includes('unanswerable')) {
    if (primary.length > 0 || acceptable.length > 0) {
      report('an unanswerable question has no anchors')
    }
  } else if (declared === 0 && !malformed) {
    report('a question needs at least one primary anchor, or the tag "unanswerable"')
  }
  const keys = [...primary, ...acceptable].map(anchorKey)
  if (new Set(keys).size !== keys.length) report('an anchor is listed twice')

  if (primaryMatch !== undefined && primaryMatch !== 'any') {
    report(
      `"primaryMatch" can only be "any"; leave it out for "all", got ${JSON.stringify(primaryMatch)}`,
    )
  }
  if (primaryMatch === 'any' && declared < 2) {
    report('"primaryMatch": "any" needs at least two primary anchors')
  }

  if (typeof id !== 'string' || !isText(question) || !isText(answer)) return undefined
  return {
    id,
    question,
    answer,
    primary,
    primaryMatch: primaryMatch === 'any' ? 'any' : 'all',
    acceptable,
    tags,
    note: isText(note) ? note : undefined,
  }
}

/** Reads a golden set, or throws a GoldenSetError that lists every problem by line. */
export function parseGoldenSet(text: string): GoldenQuestion[] {
  const problems: string[] = []
  const questions: GoldenQuestion[] = []
  const ids = new Set<string>()
  text.split('\n').forEach((line, i) => {
    if (line.trim() === '') return
    const where = `line ${String(i + 1)}`
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      problems.push(`${where}: not valid JSON`)
      return
    }
    const question = parseQuestion(value, (problem) => {
      problems.push(`${where}: ${problem}`)
    })
    if (question === undefined) return
    if (ids.has(question.id)) problems.push(`${where}: the id ${question.id} is used twice`)
    ids.add(question.id)
    questions.push(question)
  })
  if (problems.length === 0 && questions.length === 0) problems.push('the file has no questions')
  if (problems.length > 0) throw new GoldenSetError(problems)
  return questions
}
