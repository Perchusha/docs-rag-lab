// Which side a number belongs to is what a reader acts on, so these fixtures give the
// two sides different numbers everywhere, and assert whole rows.
import {
  EVAL_REPORT_VERSION,
  type EvalReport,
  type MetricDifference,
} from '@docs-rag-lab/contracts'
import { describe, expect, it } from 'vitest'

import {
  formatEvalComparison,
  formatEvalMarkdown,
  formatEvalSummary,
  formatVerification,
} from './eval-format.ts'

const metrics = (hit1: number, hit8: number, recall: number, mrr: number, acc1: number) => ({
  questions: 12,
  primary: { hits: { 1: hit1, 3: hit1 + 1, 5: hit1 + 2, 8: hit8 }, mrr },
  recallAt8: recall,
  withAcceptable: { hits: { 1: acc1, 3: acc1 + 1, 5: acc1 + 2, 8: 12 }, mrr: 0.9 },
})

const difference = (
  metric: MetricDifference['metric'],
  a: number,
  b: number,
  aBetter: number,
  bBetter: number,
  p: number,
  verdict: MetricDifference['verdict'],
): MetricDifference => ({
  metric,
  a,
  b,
  aBetter,
  bBetter,
  tied: 12 - aBetter - bBetter,
  p,
  verdict,
})

const comparison = {
  a: 'vector',
  b: 'hybrid',
  scopes: [
    {
      scope: 'overall',
      questions: 12,
      primary: [
        difference('hit@1', 9, 2, 7, 0, 0.0156, 'a'),
        difference('hit@8', 10, 11, 1, 2, 1, 'noise'),
        difference('recall@8', 0.8, 0.9, 1, 3, 0.625, 'noise'),
        difference('mrr', 0.7, 0.5, 8, 4, 0.388, 'not-significant'),
      ],
      withAcceptable: [difference('mrr', 0.9, 0.6, 9, 2, 0.065, 'not-significant')],
    },
    {
      scope: 'basic',
      questions: 8,
      primary: [difference('hit@1', 2, 8, 0, 6, 0.031, 'b')],
      withAcceptable: [],
    },
    {
      scope: 'fresh',
      questions: 3,
      primary: [difference('mrr', 0.3, 0.2, 2, 1, 1, 'too-few')],
      withAcceptable: [],
    },
  ],
}

function report(overrides: Partial<EvalReport['run']> = {}): EvalReport {
  return {
    version: EVAL_REPORT_VERSION,
    identity: {
      sourceId: 'typescript',
      docs: { repo: 'https://x.dev/repo', branch: 'v2', sha: 'd'.repeat(40) },
      chunkerVersion: 5,
      parserVersion: 1,
      indexSchema: 3,
      embedModel: 'voyage:voyage-4:1024',
      contextModel: null,
      chunksHash: 'c'.repeat(64),
      goldenSet: { version: 7, hash: 'e'.repeat(64) },
      retrievalVersion: 2,
      retrieval: { topK: 8, candidates: 50, rrfK: 60 },
    },
    vectors: { queryHash: 'q'.repeat(64), corpusHash: 'r'.repeat(64) },
    result: {
      scored: 12,
      stale: ['ts-0099'],
      review: ['ts-0098'],
      unanswerable: ['ts-0097'],
      strategies: [
        {
          strategy: 'vector',
          overall: metrics(9, 10, 0.8, 0.7, 11),
          byTag: {},
          questions: [
            {
              id: 'ts-0001',
              tags: ['basic', 'edge'],
              anchors: [],
              primaryRank: 3,
              acceptableRank: 1,
              recallAt8: 0.5,
              context: [],
            },
          ],
        },
        {
          strategy: 'hybrid',
          overall: metrics(2, 11, 0.9, 0.5, 4),
          byTag: {},
          questions: [
            {
              id: 'ts-0001',
              tags: ['basic', 'edge'],
              anchors: [],
              primaryRank: 20,
              acceptableRank: 7,
              recallAt8: 0.25,
              context: [],
            },
          ],
        },
      ],
      comparison,
      targets: [
        {
          questionId: 'ts-0001',
          anchor: 'docs/a|b.md#section contains a passage | with a pipe',
          target: 4,
          ranks: { vector: 3, hybrid: 20 },
          met: false,
        },
        {
          questionId: 'ts-0002',
          anchor: 'docs/c.md',
          target: 8,
          ranks: { vector: null },
          met: null,
        },
      ],
      chunks: { c1: { label: 'A title from the docs', docPath: 'docs/a.md' } },
    },
    run: {
      name: 'baseline',
      createdAt: '2026-11-03T12:00:00.000Z',
      repoSha: 'f'.repeat(40),
      repoDirty: false,
      timings: {},
      usage: { embeddingTokens: 0, embeddingRequests: 0 },
      ...overrides,
    },
  }
}

describe('what the reranks took', () => {
  const summaryOf = (rerank: EvalReport['run']['rerank']) =>
    formatEvalSummary({
      identity: { goldenSet: { version: 1 }, docs: { sha: 'abc' } },
      result: {
        scored: 0,
        unanswerable: [],
        stale: [],
        strategies: [],
        comparison: null,
        targets: [],
      },
      run: { rerank },
    } as unknown as EvalReport)

  it('says so when a run survived 429s', () => {
    expect(summaryOf({ calls: 40, rateLimitRetries: 2 })).toContain(
      'rerank: 40 calls, which survived 2 429s with one retry each',
    )
  })

  it('says so when none did', () => {
    expect(summaryOf({ calls: 40, rateLimitRetries: 0 })).toContain(
      'rerank: 40 calls, none retried after a 429',
    )
  })

  it('says nothing of a run with no rerank', () => {
    expect(summaryOf(undefined)).not.toContain('rerank')
  })
})

describe('formatEvalMarkdown', () => {
  const markdown = formatEvalMarkdown(report())

  it('says what the source says of its set, above the numbers, and nothing when it says nothing', () => {
    const text = formatEvalMarkdown(report(), 'Claude drafted this set.')

    expect(text.indexOf('Claude drafted this set.')).toBeGreaterThan(-1)
    expect(text.indexOf('Claude drafted this set.')).toBeLessThan(
      text.indexOf('## Primary anchors'),
    )
    expect(text.replace('Claude drafted this set.\n\n', '')).toBe(markdown)
  })

  it('puts each strategy on its own numbers, primary and recall and MRR in their columns', () => {
    expect(markdown).toContain(
      '| Strategy | Questions | hit@1 | hit@3 | hit@5 | hit@8 | recall@8 | MRR |',
    )
    expect(markdown).toContain('| vector | 12 | 9 | 10 | 11 | 10 | 0.800 | 0.700 |')
    expect(markdown).toContain('| hybrid | 12 | 2 | 3 | 4 | 11 | 0.900 | 0.500 |')
  })

  it('gives acceptable anchors their own numbers, after the primary ones', () => {
    expect(markdown).toContain('| vector | 12 | 11 | 12 | 13 | 12 | 0.900 |')
    expect(markdown).toContain('| hybrid | 12 | 4 | 5 | 6 | 12 | 0.900 |')
    expect(markdown.indexOf('## Primary anchors')).toBeLessThan(
      markdown.indexOf('## With acceptable anchors (secondary)'),
    )
  })

  it('keeps each side of a comparison under its own name, and names the right winner', () => {
    expect(markdown).toContain(
      '| Metric | vector | hybrid | vector better on | hybrid better on | Tied | p | Verdict |',
    )
    expect(markdown).toContain('| hit@1 | 9 | 2 | 7 | 0 | 5 | 0.016 | vector better |')
    expect(markdown).toContain('| hit@8 | 10 | 11 | 1 | 2 | 9 | 1.000 | noise |')
    expect(markdown).toContain('| mrr | 0.700 | 0.500 | 8 | 4 | 0 | 0.388 | not significant |')
    expect(markdown).toContain('| basic | 8 | hit@1 | 2 | 8 | 0 | 6 | 6 | 0.031 | hybrid better |')
    expect(markdown).toContain(
      '| fresh | 3 | mrr | 0.300 | 0.200 | 2 | 1 | 9 | 1.000 | too few to say |',
    )
  })

  it('states the rule, with the smallest splits that count', () => {
    expect(markdown).toContain('A difference of one or two questions is noise')
    expect(markdown).toContain('6:0, 8:1, 10:2, 12:3, 13:4 and 15:5')
  })

  it('shows the ranks of each question under each strategy', () => {
    expect(markdown).toContain('| ts-0001 | basic, edge | 3 | 20 | 1 | 7 | 0.500 | 0.250 |')
  })

  it('names the commit, the set, the settings and every list of left-out questions', () => {
    expect(markdown).toContain(`\`${'f'.repeat(40)}\``)
    expect(markdown).toContain('version 7')
    expect(markdown).toContain('topK 8, candidates 50, rrfK 60')
    expect(markdown).toContain('Stale, left out: ts-0099.')
    expect(markdown).toContain('To review, still scored: ts-0098.')
  })

  it('says when the tree was dirty', () => {
    expect(markdown).not.toContain('with uncommitted changes')
    expect(formatEvalMarkdown(report({ repoDirty: true }))).toContain('with uncommitted changes')
  })

  it('leaves out passages and chunk labels, which are the words of the docs', () => {
    expect(markdown).not.toContain('a passage')
    expect(markdown).not.toContain('A title from the docs')
  })

  it('keeps a pipe in a path from breaking its table', () => {
    expect(markdown).toContain('| ts-0001 | docs/a\\|b.md#section | 4 | 3 | 20 | no |')
  })

  it('says a target did not run rather than that it was missed', () => {
    expect(markdown).toContain('| ts-0002 | docs/c.md | 8 | - | - | did not run |')
  })

  it('reports per tag for one strategy too, where there is no comparison', () => {
    const single = report()
    single.result.comparison = null
    const [vector] = single.result.strategies
    if (vector === undefined) throw new Error('no strategy')
    vector.byTag = { basic: metrics(1, 2, 0.25, 0.125, 3) }
    single.result.strategies = [vector]

    const text = formatEvalMarkdown(single)

    expect(text).toContain('| basic | vector | 12 | 1 | 2 | 3 | 2 | 0.250 | 0.125 |')
    expect(text).not.toContain('against')
  })
})

describe('formatEvalSummary', () => {
  const summary = formatEvalSummary(report())

  it('puts each strategy on its own numbers', () => {
    const line = (name: string): string[] =>
      summary
        .split('\n')
        .find((text) => text.startsWith(`  ${name}`))
        ?.trim()
        .split(/\s+/) ?? []

    expect(line('vector')).toEqual(['vector', '12', '9', '10', '11', '10', '0.800', '0.700'])
    expect(line('hybrid')).toEqual(['hybrid', '12', '2', '3', '4', '11', '0.900', '0.500'])
  })

  it('names who won how many questions, by name', () => {
    expect(summary).toContain(
      'by MRR, vector better on 8 questions, hybrid on 4, 0 tied: p = 0.388, not significant',
    )
  })

  it('names what each strategy missed', () => {
    expect(summary).toContain('vector misses the top 8 on: none')
    expect(summary).toContain('hybrid misses the top 8 on: ts-0001')
  })

  it('says how each target stands, and tells a miss from a strategy that did not run', () => {
    expect(summary).toContain('target ts-0001 <= 4: vector 3, hybrid 20, not met')
    expect(summary).toContain('target ts-0002 <= 8: vector -, not run')
  })
})

describe('formatEvalComparison', () => {
  const text = formatEvalComparison({ ...comparison, a: 'before', b: 'after' }, 'hybrid', [
    'ts-0001: 3 -> 1',
  ])

  it('shows the direction, and keeps each side with its wins', () => {
    expect(text).toContain('hybrid: before -> after, primary anchors, 12 questions')
    expect(text).toMatch(/overall\s+hit@1\s+9 -> 2\s+better on 7 \/ 0, p = 0\.016: before better/)
    expect(text).toMatch(
      /overall\s+mrr\s+0\.700 -> 0\.500\s+better on 8 \/ 4, p = 0\.388: not significant/,
    )
  })

  it('names the winner by name when it is the second side', () => {
    const [, basic] = comparison.scopes
    if (basic === undefined) throw new Error('no scope')
    const second = formatEvalComparison(
      { a: 'before', b: 'after', scopes: [{ ...basic, scope: 'overall' }] },
      'hybrid',
      [],
    )

    expect(second).toMatch(/hit@1\s+2 -> 8\s+better on 0 \/ 6, p = 0\.031: after better/)
    expect(second).toContain('no primary rank moved')
  })

  it('names no side on a mixed result, which may be a lower total or a tie', () => {
    const mixed = {
      ...comparison,
      scopes: [
        {
          scope: 'overall',
          questions: 40,
          primary: [difference('mrr', 0.5, 0.5, 10, 2, 0.039, 'mixed')],
          withAcceptable: [],
        },
      ],
    }

    expect(formatEvalComparison(mixed, 'hybrid', [])).toMatch(
      /mrr\s+0\.500 -> 0\.500.*mixed: more wins, not a higher total/,
    )
  })

  it('reports tags with their size, and lists what moved', () => {
    expect(text).toMatch(/fresh \(3\)\s+mrr\s+0\.300 -> 0\.200.*too few to say/)
    expect(text).toContain('primary ranks that moved:\n  ts-0001: 3 -> 1')
  })
})

describe('formatVerification', () => {
  it('says what each result means', () => {
    expect(
      formatVerification({
        status: 'identical',
        changedVectors: [],
        notes: ['the target x is new'],
      }),
    ).toBe(
      'reproduced: what was measured matches the report byte for byte, on the same vectors\n  the target x is new',
    )
    expect(formatVerification({ status: 'identical', changedVectors: ['corpus'], notes: [] })).toBe(
      'reproduced: what was measured matches the report byte for byte, on other corpus vectors',
    )
    expect(
      formatVerification({
        status: 'not-comparable',
        differences: ['identity.x: report 1, now 2'],
      }),
    ).toBe(
      'not comparable: the re-run did not measure the same thing\n  identity.x: report 1, now 2',
    )
    expect(
      formatVerification({
        status: 'equivalent',
        changedVectors: ['query', 'corpus'],
        moved: ['hybrid ts-0001'],
        notes: [],
      }),
    ).toBe(
      'reproduced: other query and corpus vectors, and every context, count, verdict and target came out the same\n' +
        '  ranks below the context moved on: hybrid ts-0001',
    )
    expect(
      formatVerification({
        status: 'different',
        changedVectors: ['corpus'],
        differences: ['one thing'],
        moved: ['hybrid ts-0002'],
      }),
    ).toBe(
      'not reproduced, with other corpus vectors:\n  one thing\n  ranks below the context moved on: hybrid ts-0002',
    )
  })

  it('does not call other vectors and other code reproduced', () => {
    const text = formatVerification({
      status: 'inconclusive',
      changedVectors: ['corpus'],
      moved: [],
      notes: [],
    })

    expect(text).toMatch(/^inconclusive/)
    expect(text).not.toContain('reproduced')
  })
})
