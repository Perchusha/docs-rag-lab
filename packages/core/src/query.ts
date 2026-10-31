// Turns a question into FTS5 queries for keyword search (ADR-0005). Every term
// is quoted, so FTS5 syntax in a question (OR, NOT, NEAR, *, ^, :, quotes) is
// matched as text and never parsed as an operator.

/** The trigram tokenizer cannot match anything shorter than this. */
export const MIN_TERM_LENGTH = 3

// Common English words that carry no topic. BM25 weights frequent words down
// anyway; dropping them keeps the query short and the trace readable. Words
// that are also TypeScript keywords (any, new, type, keyof) stay in.
const STOPWORDS = new Set(
  (
    'a an and are as at be been but by can could did do does doing for from had has have ' +
    'how i if in into is it its me my not of on or our should so than that the their them ' +
    'then there these they this those to was we were what when where which while who why ' +
    'will with would you your'
  ).split(' '),
)

export type ExactTokenOrigin = 'backticks' | 'identifier' | 'flag' | 'source'

export interface ExactToken {
  token: string
  from: ExactTokenOrigin
}

export interface QueryPlan {
  /** Words of the question (and source tokens) that keyword search looks for, lowercased. */
  terms: string[]
  /** FTS5 query over the terms, each one quoted and OR-ed; '' when there are none. */
  keywordQuery: string
  /** Tokens to match as written: code in backticks, identifiers, flags, source tokens. */
  exactTokens: ExactToken[]
  /** FTS5 query over the exact tokens alone; '' when there are none. */
  exactQuery: string
}

/** An FTS5 string: inside double quotes, with quotes doubled. */
export function quoteTerm(term: string): string {
  return `"${term.replaceAll('"', '""')}"`
}

function orQuery(terms: readonly string[]): string {
  return terms.map(quoteTerm).join(' OR ')
}

/** Long enough for trigram matching, counted in code points (as SQLite does), not UTF-16 units. */
function longEnough(text: string): boolean {
  return (text.trim().match(/./gsu)?.length ?? 0) >= MIN_TERM_LENGTH
}

// camelCase or PascalCase with an inner capital: noUncheckedIndexedAccess, NoInfer.
const IDENTIFIER = /[A-Za-z_$][\w$]*/g
const INNER_CAPITAL = /[a-z0-9][A-Z]/
// A command-line flag outside backticks: --strict, --erasableSyntaxOnly.
const FLAG = /(?:^|\s)--([A-Za-z][\w-]*)/g

function exactTokensOf(question: string, sourceTokens: readonly string[]): ExactToken[] {
  const found: ExactToken[] = []
  for (const match of question.matchAll(/`([^`]+)`/g)) {
    // `--strict` is written strict on option pages and --strict in release notes.
    found.push({ token: (match[1] ?? '').trim().replace(/^-+/, ''), from: 'backticks' })
  }
  const outsideCode = question.replace(/`[^`]*`/g, ' ')
  for (const match of outsideCode.matchAll(FLAG))
    found.push({ token: match[1] ?? '', from: 'flag' })
  for (const [token] of outsideCode.matchAll(IDENTIFIER)) {
    if (INNER_CAPITAL.test(token)) found.push({ token, from: 'identifier' })
  }
  for (const token of sourceTokens) found.push({ token, from: 'source' })

  const seen = new Set<string>()
  return found.filter(({ token }) => {
    const key = token.toLowerCase()
    if (!longEnough(token) || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Plans the keyword queries for a question. `sourceTokens` come from the
 * source (Source.exactTokens): TypeScript turns TS2345 into 2345, the way
 * its docs write error codes.
 */
export function analyzeQuery(question: string, sourceTokens: readonly string[] = []): QueryPlan {
  const words = question.match(/[\p{L}\p{N}_]+/gu) ?? []
  const terms = [
    ...new Set(
      [...words, ...sourceTokens]
        .map((word) => word.toLowerCase())
        .filter((word) => longEnough(word) && !STOPWORDS.has(word)),
    ),
  ]
  const exactTokens = exactTokensOf(question, sourceTokens)
  return {
    terms,
    keywordQuery: orQuery(terms),
    exactTokens,
    exactQuery: orQuery(exactTokens.map(({ token }) => token)),
  }
}
