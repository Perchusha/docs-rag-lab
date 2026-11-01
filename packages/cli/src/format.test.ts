import type { RetrievalTrace } from '@docs-rag-lab/contracts'
import type { SyncReport } from '@docs-rag-lab/core'
import { describe, expect, it } from 'vitest'

import {
  formatCitations,
  formatDuration,
  formatEmbedProgress,
  formatEstimateRatio,
  formatSyncReport,
  formatTrace,
} from './format.ts'

describe('formatDuration', () => {
  it('uses seconds, then minutes, then hours', () => {
    expect(formatDuration(3_210)).toBe('3.2s')
    expect(formatDuration(252_000)).toBe('4m 12s')
    expect(formatDuration(3_723_000)).toBe('1h 02m 03s')
  })
})

describe('formatEmbedProgress', () => {
  it('shows progress, cache hits, elapsed time and rate-limit waiting', () => {
    expect(
      formatEmbedProgress(
        { embedded: 120, toEmbed: 980, cached: 13, estimatedTokens: 0, waitedMs: 125_000 },
        190_000,
      ),
    ).toBe(
      'embedding: 120/980 chunks (12%), 13 from cache, 3m 10s elapsed, 2m 05s waiting on rate limits',
    )
  })
})

describe('formatSyncReport', () => {
  it('summarizes changes, vectors, the index per doc type and time', () => {
    const report: SyncReport = {
      mode: 'incremental',
      reason: undefined,
      previousSha: 'aaaaaaaa11111111',
      headSha: 'bbbbbbbb22222222',
      documents: { added: 1, modified: 2, unchanged: 0, deleted: 1 },
      chunks: { added: 3, changed: 2, unchanged: 10, deleted: 4 },
      vectors: { needed: 5, embedded: 4, cached: 1 },
      estimatedTokens: 2_500,
      stats: {
        documents: 248,
        chunks: 993,
        tokens: 505_879,
        byDocType: [{ docType: 'handbook', documents: 18, chunks: 150, tokens: 70_000 }],
      },
    }

    expect(formatSyncReport(report, 65_000, 30_000).split('\n')).toEqual([
      'sync: incremental, aaaaaaaa -> bbbbbbbb',
      'documents: 1 added, 2 modified, 0 unchanged, 1 deleted',
      'chunks: 3 added, 2 changed, 10 unchanged, 4 deleted',
      'vectors: 5 needed, 4 embedded, 1 from cache, 2,500 estimated tokens sent',
      'index: 248 documents, 993 chunks, 505,879 estimated tokens',
      '  handbook          18 docs    150 chunks    70,000 tokens',
      'time: 1m 05s, of which 30.0s waiting on rate limits',
    ])
  })
})

describe('formatEstimateRatio', () => {
  it('compares billed and estimated tokens, or says nothing without both', () => {
    expect(formatEstimateRatio(8_000, 10_000)).toBe(
      'tokens: 8,000 billed vs 10,000 estimated (billed/estimated 0.80)',
    )
    expect(formatEstimateRatio(0, 10_000)).toBeUndefined()
  })
})

describe('formatCitations', () => {
  it('lists numbered sources with a one-line quote', () => {
    expect(
      formatCitations([
        {
          number: 1,
          title: 'Everyday Types > Union Types',
          source: 'https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#union-types',
          citedText: 'A union type is a type formed\nfrom two or more other types.',
        },
      ]),
    ).toBe(
      'Sources:\n[1] Everyday Types > Union Types\n' +
        '    https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#union-types\n' +
        '    "A union type is a type formed from two or more other types."',
    )
    expect(formatCitations([])).toBe('Sources: none cited.')
  })
})

describe('formatTrace', () => {
  // headingPath [] is a pack of sections under the document root: the label
  // comes from sectionPath, the section the chunk starts in.
  const chunk = (title: string, heading: string, docType: string, headingPath = [heading]) => ({
    docPath: `${title}.md`,
    title,
    headingPath,
    sectionPath: [heading],
    anchor: heading.toLowerCase(),
    docType,
    tokenCount: 10,
  })
  const trace: RetrievalTrace = {
    version: 2,
    question: 'What does error TS2345 mean?',
    sourceId: 'typescript',
    strategy: 'hybrid',
    params: { topK: 2, candidates: 50, rrfK: 60 },
    filters: { docTypes: [] },
    query: {
      terms: ['error', 'ts2345', 'mean', '2345'],
      exactTokens: [
        { token: 'TS2345', from: 'source' },
        { token: '2345', from: 'source' },
      ],
    },
    embedding: { provider: 'voyage:voyage-4:1024', from: 'cache', ms: 0.42 },
    lists: [
      {
        name: 'vector',
        scoring: 'cosine-distance',
        ms: 1.5,
        candidates: [
          { chunkId: 'a', rank: 1, score: 0.6213 },
          { chunkId: 'b', rank: 2, score: 0.65 },
        ],
      },
      {
        name: 'keyword',
        scoring: 'bm25',
        query: '"error" OR "2345"',
        ms: 0.8,
        candidates: [{ chunkId: 'b', rank: 1, score: 12.345 }],
      },
      {
        name: 'exact',
        scoring: 'bm25',
        skipped: 'no exact tokens in the question',
        ms: 0,
        candidates: [],
      },
    ],
    fusion: {
      method: 'rrf',
      k: 60,
      ms: 0.1,
      ranked: [
        { chunkId: 'b', rank: 1, score: 1 / 62 + 1 / 61, ranks: { vector: 2, keyword: 1 } },
        { chunkId: 'a', rank: 2, score: 1 / 61, ranks: { vector: 1 } },
      ],
    },
    chunks: {
      a: chunk('Checks', 'checkJs', 'option'),
      b: chunk('Everyday Types', 'Literal Inference', 'handbook', []),
    },
    context: [
      {
        rank: 1,
        chunkId: 'b',
        source: 'https://x.dev/b#literal-inference',
        title: 'Everyday Types > Literal Inference',
        text: 'b',
      },
      {
        rank: 2,
        chunkId: 'a',
        source: 'https://x.dev/a#checkjs',
        title: 'Checks > checkJs',
        text: 'a',
      },
    ],
    totalMs: 3.21,
  }

  it('prints the query, every list with ranks and scores, the fused ranking and the context', () => {
    expect(formatTrace(trace).split('\n')).toEqual([
      'retrieval: hybrid over typescript, top 2',
      'terms: error, ts2345, mean, 2345',
      'exact tokens: TS2345 (source), 2345 (source)',
      'doc types: all',
      'query vector: from cache, 0.4ms',
      '',
      'vector (cosine distance, lower is better): 2 candidates, 1.5ms',
      '   1.  0.6213  Checks > checkJs  [option]',
      '   2.  0.6500  Everyday Types > Literal Inference  [handbook]',
      '',
      'keyword (BM25, higher is better): 1 candidates, 0.8ms, "error" OR "2345"',
      '   1.   12.35  Everyday Types > Literal Inference  [handbook]',
      '',
      'exact: skipped, no exact tokens in the question',
      '',
      'fused (RRF, k=60): 2 candidates, 0.1ms',
      '   1. 0.0325  v2  k1   Everyday Types > Literal Inference  [handbook]',
      '   2. 0.0164  v1  k-   Checks > checkJs  [option]',
      '',
      'context: 2 chunks go to the answer',
      '   1. Everyday Types > Literal Inference',
      '      https://x.dev/b#literal-inference',
      '   2. Checks > checkJs',
      '      https://x.dev/a#checkjs',
      '',
      'retrieval time: 3.2ms',
    ])
  })

  it('shows only the first entries of long lists, and no fusion for vector search', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ chunkId: 'a', rank: i + 1, score: 0.5 }))
    const vector: RetrievalTrace = {
      ...trace,
      strategy: 'vector',
      filters: { docTypes: ['option', 'handbook'] },
      lists: [{ name: 'vector', scoring: 'cosine-distance', ms: 1, candidates: many }],
      fusion: { method: 'none' },
    }
    const text = formatTrace(vector, 10)
    expect(text).toContain('doc types: option, handbook')
    expect(text).toContain('  10.  0.5000')
    expect(text).not.toContain('  11.  0.5000')
    expect(text).toContain('      (2 more)')
    expect(text).not.toContain('fused')
  })
})
