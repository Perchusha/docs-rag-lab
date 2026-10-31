import { openSourceIndex, type ChunkWrite } from '@docs-rag-lab/db'
import { describe, expect, it } from 'vitest'

import { analyzeQuery, quoteTerm } from './query.ts'

/** A small index with one keyword table, to prove the generated queries parse in FTS5. */
function indexOf(texts: string[]) {
  const index = openSourceIndex(':memory:')
  const chunks: ChunkWrite[] = texts.map((text, i) => ({
    id: `c${String(i)}`,
    ordinal: i,
    headingPath: [],
    anchor: '',
    blockTypes: ['prose'],
    text,
    metadata: {},
    tokenCount: 1,
    textHash: `h${String(i)}`,
    vector: new Float32Array([1, 0]),
  }))
  index.applyChanges({
    documents: [
      {
        path: 'a.md',
        url: 'https://x.dev/a',
        title: 'A',
        docType: 'handbook',
        contentHash: 'h',
        lastChangedSha: 's',
        chunks,
      },
    ],
    deletePaths: [],
    manifest: {
      sourceId: 'demo',
      repo: 'r',
      branch: 'main',
      includePaths: ['docs'],
      commitSha: 's',
      syncedAt: '2026-10-31T00:00:00.000Z',
      embedModel: 'fake:hash:2',
      embedDimensions: 2,
      contextModel: null,
      chunkerVersion: 1,
      parserVersion: 1,
    },
  })
  return index
}

describe('analyzeQuery', () => {
  it('keeps topic words, lowercased and unique, and drops stopwords and short words', () => {
    const plan = analyzeQuery('What does the Strict flag do? Is strict on by default?')
    expect(plan.terms).toEqual(['strict', 'flag', 'default'])
    expect(plan.keywordQuery).toBe('"strict" OR "flag" OR "default"')
  })

  it('keeps words that are TypeScript keywords even when they are common English', () => {
    expect(analyzeQuery('What is the difference between unknown and any?').terms).toEqual([
      'difference',
      'between',
      'unknown',
      'any',
    ])
  })

  it('finds exact tokens: code in backticks, identifiers and flags, without duplicates', () => {
    const plan = analyzeQuery(
      'Does `--erasableSyntaxOnly` work with isolatedModules and --strict, like `NoInfer<T>` or isolatedModules?',
    )
    expect(plan.exactTokens).toEqual([
      { token: 'erasableSyntaxOnly', from: 'backticks' },
      { token: 'NoInfer<T>', from: 'backticks' },
      { token: 'strict', from: 'flag' },
      { token: 'isolatedModules', from: 'identifier' },
    ])
    expect(plan.exactQuery).toBe(
      '"erasableSyntaxOnly" OR "NoInfer<T>" OR "strict" OR "isolatedModules"',
    )
  })

  it('takes camelCase outside backticks, but not PascalCase product names', () => {
    const plan = analyzeQuery(
      'Since which TypeScript version can JavaScript files use noImplicitAny or NoInfer?',
    )
    expect(plan.exactTokens).toEqual([{ token: 'noImplicitAny', from: 'identifier' }])
    // In backticks anything counts: the question marks it as code.
    expect(analyzeQuery('What is `NoInfer`?').exactTokens).toEqual([
      { token: 'NoInfer', from: 'backticks' },
    ])
  })

  it('adds source tokens to both queries', () => {
    const plan = analyzeQuery('What does error TS2345: mean?', ['TS2345', '2345'])
    expect(plan.terms).toEqual(['error', 'ts2345', 'mean', '2345'])
    expect(plan.exactTokens).toEqual([
      { token: 'TS2345', from: 'source' },
      { token: '2345', from: 'source' },
    ])
  })

  it('drops tokens shorter than 3 characters, which the trigram tokenizer cannot match', () => {
    const plan = analyzeQuery('Is `as` or `in` or `T` like `as const`? TS or JS?')
    expect(plan.exactTokens.map((t) => t.token)).toEqual(['as const'])
    expect(plan.terms).toEqual(['like', 'const'])
  })

  it('returns empty queries when nothing is left to search for', () => {
    expect(analyzeQuery('What is it?')).toEqual({
      terms: [],
      keywordQuery: '',
      exactTokens: [],
      exactQuery: '',
    })
  })

  it('quotes every term, so FTS5 syntax in a question is text, never an operator', () => {
    const questions = [
      'What does --strict do?',
      'What does TS2345: mean?',
      'Why is `method: "GET"` widened?',
      'Is Partial<T>* a thing?',
      'NOT strict OR loose AND NEAR(x y) ^start col:value',
      'A lone " quote and a `"` in code',
    ]
    const index = indexOf([
      'strict mode, near the start of a column value',
      'method: "GET" is widened to string',
      'loose checks and partial types',
    ])
    for (const question of questions) {
      const plan = analyzeQuery(question)
      for (const query of [plan.keywordQuery, plan.exactQuery].filter((q) => q !== '')) {
        expect(query).toMatch(/^"(?:[^"]|"")*"(?: OR "(?:[^"]|"")*")*$/)
        expect(() => index.searchKeywords(query, 5)).not.toThrow()
      }
    }
    expect(analyzeQuery('Why is `method: "GET"` widened?').exactQuery).toBe('"method: ""GET"""')
    expect(
      index.searchKeywords(analyzeQuery('Why is `method: "GET"` widened?').exactQuery, 5),
    ).toHaveLength(1)
    // Bare OR, AND and NOT are stopwords and drop out; NEAR is a word, quoted.
    expect(analyzeQuery('NOT strict OR loose').keywordQuery).toBe('"strict" OR "loose"')
    expect(analyzeQuery('NEAR the end').keywordQuery).toBe('"near" OR "end"')
    // In code they survive, quoted, and are searched as text, not run as operators.
    const operators = analyzeQuery('Is `NOT` or `AND` a keyword?')
    expect(operators.exactQuery).toBe('"NOT" OR "AND"')
    // "AND" finds the chunk with the word "and"; as an operator it would need two operands.
    expect(index.searchKeywords(operators.exactQuery, 5).map((hit) => hit.chunkId)).toEqual(['c2'])
    expect(index.searchKeywords('"near"', 5).map((hit) => hit.chunkId)).toEqual(['c0'])
  })

  it('ranks the chunk with the rare term first when common words are everywhere', () => {
    const common = Array.from(
      { length: 20 },
      (_, i) =>
        `Every type has a type annotation and the type checker reads type number ${String(i)}.`,
    )
    const index = indexOf([...common, 'The satisfies operator checks a value.'])
    const plan = analyzeQuery('What does the satisfies operator do to a type?')
    const hits = index.searchKeywords(plan.keywordQuery, 5)
    expect(hits[0]?.chunkId).toBe('c20')
  })
})

describe('quoteTerm', () => {
  it('doubles inner quotes', () => {
    expect(quoteTerm('a "b" c')).toBe('"a ""b"" c"')
  })
})
