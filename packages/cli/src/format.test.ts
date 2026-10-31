import type { SyncReport } from '@docs-rag-lab/core'
import { describe, expect, it } from 'vitest'

import {
  formatCitations,
  formatDuration,
  formatEmbedProgress,
  formatEstimateRatio,
  formatSyncReport,
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
