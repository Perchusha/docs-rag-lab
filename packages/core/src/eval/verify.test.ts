import { EVAL_REPORT_VERSION, type EvalMetrics, type EvalReport } from '@docs-rag-lab/contracts'
import { describe, expect, it } from 'vitest'

import { metricsOf, strategyResult } from './metrics.ts'
import { verifyReport } from './verify.ts'

const score = (id: string, primaryRank: number | null) => ({
  id,
  tags: ['basic'],
  anchors: [{ anchor: `${id}.md`, role: 'primary' as const, rank: primaryRank }],
  primaryRank,
  acceptableRank: primaryRank,
  recallAt8: primaryRank !== null && primaryRank <= 8 ? 1 : 0,
  context: [`${id}-top`],
})

/** Forty questions, so a deep rank moves the MRR as little as it does on the real set. */
function report(ranks: Record<string, number | null> = {}): EvalReport {
  const ids = Array.from({ length: 40 }, (_, i) => `ts-${String(i + 1).padStart(4, '0')}`)
  const questions = ids.map((id) => score(id, id in ranks ? (ranks[id] ?? null) : 1))
  return {
    version: EVAL_REPORT_VERSION,
    identity: {
      sourceId: 'demo',
      docs: { repo: 'r', branch: 'main', sha: 'docs-sha' },
      chunkerVersion: 5,
      parserVersion: 1,
      embedModel: 'fake',
      chunksHash: 'chunks',
      goldenSet: { version: 1, hash: 'set' },
      retrieval: { topK: 8, candidates: 50, rrfK: 60 },
    },
    vectors: { queryHash: 'q', corpusHash: 'c' },
    result: {
      scored: questions.length,
      stale: [],
      review: [],
      unanswerable: [],
      strategies: [strategyResult('hybrid', questions)],
      comparison: null,
      targets: [],
      chunks: {},
    },
    run: {
      name: null,
      createdAt: 'then',
      repoSha: 'repo',
      repoDirty: false,
      timings: {},
      usage: { embeddingTokens: 0, embeddingRequests: 0 },
    },
  }
}

const otherVectors = (value: EvalReport, query = 'q2', corpus = 'c2'): EvalReport => ({
  ...value,
  vectors: { queryHash: query, corpusHash: corpus },
})

describe('verifyReport', () => {
  it('calls a byte-identical result identical, whatever the run says', () => {
    const later: EvalReport = {
      ...report(),
      run: { ...report().run, createdAt: 'later', repoSha: 'other', repoDirty: true },
    }

    expect(verifyReport(report(), later)).toEqual({ status: 'identical' })
  })

  it('is identical with other vectors too, when nothing moved', () => {
    expect(verifyReport(report(), otherVectors(report()))).toEqual({ status: 'identical' })
  })

  it.each([
    ['the docs commit', { docs: { repo: 'r', branch: 'main', sha: 'other' } }, 'identity.docs.sha'],
    ['the chunks', { chunksHash: 'other' }, 'identity.chunksHash'],
    ['the chunker', { chunkerVersion: 6 }, 'identity.chunkerVersion'],
    ['the parser', { parserVersion: 2 }, 'identity.parserVersion'],
    ['the embedding model', { embedModel: 'other' }, 'identity.embedModel'],
    ['the golden set', { goldenSet: { version: 2, hash: 'set' } }, 'identity.goldenSet.version'],
    [
      'the retrieval settings',
      { retrieval: { topK: 8, candidates: 50, rrfK: 30 } },
      'identity.retrieval.rrfK',
    ],
  ])('calls a change in %s not comparable, and names it', (_name, change, field) => {
    const now: EvalReport = { ...report(), identity: { ...report().identity, ...change } }

    const verification = verifyReport(report(), now)

    expect(verification.status).toBe('not-comparable')
    expect(verification.status === 'not-comparable' && verification.differences[0]).toContain(field)
  })

  it('calls another result from the same vectors different: the code changed', () => {
    expect(verifyReport(report(), report({ 'ts-0001': 2 }))).toEqual({
      status: 'different',
      changedVectors: [],
      differences: ['the vectors are the same and the result is not'],
    })
  })

  describe('with other vectors', () => {
    it('calls a move below every cutoff equivalent, and says what moved', () => {
      const before = report({ 'ts-0001': 20 })
      const after = otherVectors(report({ 'ts-0001': 21 }))

      const verification = verifyReport(before, after)

      expect(verification).toMatchObject({
        status: 'equivalent',
        changedVectors: ['query', 'corpus'],
        moved: ['hybrid ts-0001'],
      })
      expect(verification.status === 'equivalent' && verification.mrr[0]).toContain('MRR')
    })

    it('names only the vectors that changed', () => {
      const verification = verifyReport(
        report({ 'ts-0001': 20 }),
        otherVectors(report({ 'ts-0001': 21 }), 'q2', 'c'),
      )

      expect(verification).toMatchObject({ changedVectors: ['query'] })
    })

    it('calls a move across a cutoff different, and names the count', () => {
      const verification = verifyReport(
        report({ 'ts-0001': 8 }),
        otherVectors(report({ 'ts-0001': 9 })),
      )

      expect(verification.status).toBe('different')
      const differences = verification.status === 'different' ? verification.differences : []
      expect(differences).toContain('hybrid overall primary hit@8: report 40, now 39')
      expect(differences).toContain('hybrid overall recall@8: report 1, now 0.975')
    })

    it('calls an MRR that moved beyond the tolerance different, with every count the same', () => {
      // Ranks 6 and 8 on five questions: no cutoff is crossed.
      const six = Object.fromEntries(
        ['ts-0001', 'ts-0002', 'ts-0003', 'ts-0004', 'ts-0005', 'ts-0006'].map((id) => [id, 6]),
      )
      const eight = Object.fromEntries(Object.keys(six).map((id) => [id, 8]))

      const verification = verifyReport(report(six), otherVectors(report(eight)))

      expect(verification.status).toBe('different')
      expect(verification.status === 'different' && verification.differences[0]).toContain('MRR')
    })

    it('looks at each tag too, not only the overall numbers', () => {
      const before = report()
      const metrics = (questions: number): EvalMetrics =>
        metricsOf(Array.from({ length: questions }, (_, i) => score(`q${String(i)}`, 1)))
      const strategy = before.result.strategies[0]
      if (strategy === undefined) throw new Error('no strategy')
      const after = otherVectors({
        ...before,
        result: {
          ...before.result,
          strategies: [{ ...strategy, byTag: { basic: metrics(39) } }],
        },
      })

      const verification = verifyReport(before, after)

      expect(verification.status === 'different' && verification.differences[0]).toContain(
        'hybrid basic questions',
      )
    })

    it('calls a strategy that did not run different', () => {
      const before = report()
      const after = otherVectors({
        ...before,
        result: { ...before.result, strategies: [] },
      })

      expect(verifyReport(before, after)).toMatchObject({
        status: 'different',
        differences: ['hybrid: did not run'],
      })
    })
  })
})
