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

  describe('with exactTokens: code-shaped (ADR-0011)', () => {
    const codeShaped = (question: string, sourceTokens: string[] = []) =>
      analyzeQuery(question, sourceTokens, { exactTokens: 'code-shaped' })

    it('drops a backticked plain word, which stays a search term', () => {
      const plan = codeShaped('In which version did `satisfies` appear?')

      expect(plan.exactTokens).toEqual([])
      expect(plan.exactQuery).toBe('')
      expect(plan.terms).toContain('satisfies')
      expect(plan.keywordQuery).toContain('"satisfies"')
    })

    it('drops a lowercase word in any script', () => {
      expect(codeShaped('Что такое `строка`?').exactTokens).toEqual([])
    })

    it.each([
      ['PascalCase', 'Omit'],
      ['camelCase', 'noImplicitAny'],
      ['digits', 'es2022'],
      ['punctuation', 'tsconfig.json'],
      ['a suffix', 'any[]'],
      ['a prefix', '#private'],
      ['spaces', 'import type'],
      ['a signature', '() => void'],
    ])('keeps code with %s', (_name, code) => {
      expect(codeShaped(`What is \`${code}\`?`).exactTokens).toEqual([
        { token: code, from: 'backticks' },
      ])
    })

    it('keeps a flag in backticks, without its dashes', () => {
      expect(codeShaped('What does `--strict` do?').exactTokens).toEqual([
        { token: 'strict', from: 'backticks' },
      ])
    })

    it('keeps flags, identifiers and source tokens outside backticks', () => {
      expect(
        codeShaped('Does --strict imply noImplicitAny, and what is TS2345?', ['2345']).exactTokens,
      ).toEqual([
        { token: 'strict', from: 'flag' },
        { token: 'noImplicitAny', from: 'identifier' },
        { token: '2345', from: 'source' },
      ])
    })

    it('keeps a word that is also written as a flag', () => {
      expect(codeShaped('Is `strict` the same as --strict?').exactTokens).toEqual([
        { token: 'strict', from: 'flag' },
      ])
    })

    it('changes nothing unless asked', () => {
      const question = 'In which version did `satisfies` appear?'

      expect(analyzeQuery(question, [], { exactTokens: 'all' })).toEqual(analyzeQuery(question))
      expect(analyzeQuery(question).exactTokens).toEqual([
        { token: 'satisfies', from: 'backticks' },
      ])
    })
  })

  describe('with shortTerms: whole-word (ADR-0011)', () => {
    const wholeWord = (question: string, sourceTokens: string[] = []) =>
      analyzeQuery(question, sourceTokens, { shortTerms: 'whole-word' })

    it('moves 3-character terms and tokens to the whole-word queries, in any script', () => {
      const plan = wholeWord('В чём разница между `unknown` и `any`?')

      expect(plan.keywordQuery).toBe('"разница" OR "между" OR "unknown"')
      expect(plan.keywordWholeWords).toBe('"чём" OR "any"')
      expect(plan.exactQuery).toBe('"unknown"')
      expect(plan.exactWholeWords).toBe('"any"')
      expect(plan.terms).toEqual(['чём', 'разница', 'между', 'unknown', 'any'])
    })

    it('takes digits as part of a word, and a source token too', () => {
      const plan = wholeWord('Is width 100 fine?', ['abc'])

      expect(plan.keywordWholeWords).toBe('"100" OR "abc"')
      expect(plan.exactWholeWords).toBe('"abc"')
    })

    it('leaves a 4-character term on trigram', () => {
      const plan = wholeWord('What is a type?')

      expect(plan.keywordQuery).toBe('"type"')
      expect(plan.keywordWholeWords).toBe('')
    })

    it.each(['...', 'a|b', 'a_b'])(
      'leaves %s on trigram, since unicode61 would split it',
      (code) => {
        const plan = wholeWord(`What is \`${code}\`?`)

        expect(plan.exactQuery).toBe(`"${code}"`)
        expect(plan.exactWholeWords).toBe('')
      },
    )

    it('can leave the trigram query empty', () => {
      const plan = wholeWord('any?')

      expect(plan.keywordQuery).toBe('')
      expect(plan.keywordWholeWords).toBe('"any"')
    })

    it('changes nothing unless asked', () => {
      const plan = analyzeQuery('Why `any` over `unknown`?')

      expect(plan.keywordWholeWords).toBe('')
      expect(plan.exactWholeWords).toBe('')
      expect(plan.keywordQuery).toBe('"any" OR "over" OR "unknown"')
      expect(plan.exactQuery).toBe('"any" OR "unknown"')
    })

    it('works together with code-shaped tokens', () => {
      const plan = analyzeQuery('Why `any` and `Omit`?', [], {
        exactTokens: 'code-shaped',
        shortTerms: 'whole-word',
      })

      expect(plan.exactQuery).toBe('"Omit"')
      expect(plan.exactWholeWords).toBe('')
      expect(plan.keywordQuery).toBe('"omit"')
      expect(plan.keywordWholeWords).toBe('"any"')
    })

    it('makes queries that a real index accepts', () => {
      const index = indexOf(['the any type', 'many a company', 'omit a key'])
      const plan = wholeWord('Why `any` and omit?')

      const found = index.searchKeywords(plan.keywordQuery, 5, {}, plan.keywordWholeWords)

      expect(found.map((hit) => hit.chunkId).sort()).toEqual(['c0', 'c2'])
      index.close()
    })
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
      keywordWholeWords: '',
      exactTokens: [],
      exactQuery: '',
      exactWholeWords: '',
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
