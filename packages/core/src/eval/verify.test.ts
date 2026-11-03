import {
  EVAL_REPORT_VERSION,
  type EvalComparison,
  type EvalQuestionScore,
  type EvalReport,
} from '@docs-rag-lab/contracts'
import { describe, expect, it } from 'vitest'

import { compareScores } from './compare.ts'
import { strategyResult } from './metrics.ts'
import { fieldDifferences, verifyReport } from './verify.ts'

/** A question with a primary and an acceptable anchor, so the two can move apart. */
function score(
  id: string,
  primaryRank: number | null,
  acceptableRank: number | null = primaryRank,
): EvalQuestionScore {
  return {
    id,
    tags: ['basic'],
    anchors: [
      { anchor: `${id}.md`, role: 'primary', rank: primaryRank },
      { anchor: `${id}-alt.md`, role: 'acceptable', rank: acceptableRank },
    ],
    primaryRank,
    acceptableRank,
    recallAt8: primaryRank !== null && primaryRank <= 8 ? 1 : 0,
    context: [`${id}-top`],
  }
}

const IDS = Array.from({ length: 40 }, (_, i) => `ts-${String(i + 1).padStart(4, '0')}`)

type Ranks = Record<string, number | null>

function report(
  ranks: Ranks = {},
  options: { acceptable?: Ranks; comparison?: EvalComparison | null } = {},
): EvalReport {
  const questions = IDS.map((id) => {
    const primary = id in ranks ? (ranks[id] ?? null) : 1
    const acceptable = options.acceptable?.[id]
    return score(id, primary, acceptable === undefined ? primary : acceptable)
  })
  return {
    version: EVAL_REPORT_VERSION,
    identity: {
      sourceId: 'demo',
      docs: { repo: 'r', branch: 'main', sha: 'docs-sha' },
      chunkerVersion: 5,
      parserVersion: 1,
      indexSchema: 3,
      embedModel: 'fake',
      contextModel: null,
      chunksHash: 'chunks',
      goldenSet: { version: 1, hash: 'set' },
      retrievalVersion: 1,
      retrieval: { topK: 8, candidates: 50, rrfK: 60 },
    },
    vectors: { queryHash: 'q', corpusHash: 'c' },
    result: {
      scored: questions.length,
      stale: [],
      review: [],
      unanswerable: [],
      strategies: [strategyResult('hybrid', questions)],
      comparison: options.comparison ?? null,
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

function differencesOf(before: EvalReport, after: EvalReport): string[] {
  const verification = verifyReport(before, after)
  expect(verification.status).toBe('different')
  return verification.status === 'different' ? verification.differences : []
}

describe('fieldDifferences', () => {
  it('names each field that differs, however deep, and only those', () => {
    expect(fieldDifferences('x', { a: 1, b: { c: 2, d: 3 } }, { a: 1, b: { c: 9, d: 3 } })).toEqual(
      ['x.b.c: report 2, now 9'],
    )
  })

  it('notices a field only one side has', () => {
    expect(fieldDifferences('x', { a: 1 }, { a: 1, b: 2 })).toEqual([
      'x.b: report undefined, now 2',
    ])
  })

  it('takes labels for two reports that are neither old nor new', () => {
    expect(fieldDifferences('x', 1, 2, { a: 'baseline', b: 'after' })).toEqual([
      'x: baseline 1, after 2',
    ])
  })
})

describe('verifyReport', () => {
  it('calls a byte-identical result identical, whatever the run says', () => {
    const later: EvalReport = {
      ...report(),
      run: { ...report().run, createdAt: 'later', repoSha: 'other', repoDirty: true },
    }

    expect(verifyReport(report(), later)).toEqual({
      status: 'identical',
      changedVectors: [],
      notes: [],
    })
  })

  it('is identical with other vectors and other code, since nothing moved', () => {
    const later = otherVectors(report())
    later.run = { ...later.run, repoSha: 'other', repoDirty: true }

    expect(verifyReport(report(), later)).toEqual({
      status: 'identical',
      changedVectors: ['query', 'corpus'],
      notes: [],
    })
  })

  it('does not count a reworded chunk label, which is only for reading', () => {
    const before = report()
    before.result.chunks = { c1: { label: 'Old', docPath: 'a.md' } }
    const after = report()
    after.result.chunks = { c1: { label: 'New', docPath: 'a.md' } }

    expect(verifyReport(before, after).status).toBe('identical')
  })

  it('does not count the order of the keys in a file', () => {
    const after = report()
    const [strategy] = after.result.strategies
    if (strategy === undefined) throw new Error('no strategy')
    strategy.overall = Object.fromEntries(
      Object.entries(strategy.overall).reverse(),
    ) as typeof strategy.overall

    expect(verifyReport(report(), after).status).toBe('identical')
  })

  it('is identical with other vectors too, when nothing measured moved, and says so', () => {
    expect(verifyReport(report(), otherVectors(report()))).toEqual({
      status: 'identical',
      changedVectors: ['query', 'corpus'],
      notes: [],
    })
  })

  it.each([
    ['the docs commit', { docs: { repo: 'r', branch: 'main', sha: 'other' } }, 'identity.docs.sha'],
    ['the chunks', { chunksHash: 'other' }, 'identity.chunksHash'],
    ['the chunker', { chunkerVersion: 6 }, 'identity.chunkerVersion'],
    ['the parser', { parserVersion: 2 }, 'identity.parserVersion'],
    ['the index schema', { indexSchema: 4 }, 'identity.indexSchema'],
    ['the embedding model', { embedModel: 'other' }, 'identity.embedModel'],
    ['the context model', { contextModel: 'other' }, 'identity.contextModel'],
    ['the golden set', { goldenSet: { version: 2, hash: 'set' } }, 'identity.goldenSet.version'],
    ['the retrieval code', { retrievalVersion: 2 }, 'identity.retrievalVersion'],
    [
      'the retrieval settings',
      { retrieval: { topK: 8, candidates: 50, rrfK: 30 } },
      'identity.retrieval.rrfK',
    ],
    [
      'a setting the report does not have',
      { retrieval: { topK: 8, candidates: 50, rrfK: 60, wordMatch: true } },
      'identity.retrieval.wordMatch',
    ],
  ])('calls a change in %s not comparable, and names it', (_name, change, field) => {
    const now: EvalReport = { ...report(), identity: { ...report().identity, ...change } }

    const verification = verifyReport(report(), now)

    expect(verification.status).toBe('not-comparable')
    expect(verification.status === 'not-comparable' && verification.differences[0]).toContain(field)
  })

  describe('with the same vectors', () => {
    it('calls another result different, and blames the code when the code changed', () => {
      const now = report({ 'ts-0001': 2 })
      now.run.repoSha = 'other'

      expect(differencesOf(report(), now)[0]).toBe(
        'the vectors are the same and the result is not: the code changed',
      )
    })

    it('calls it not deterministic when the code is the same too', () => {
      expect(differencesOf(report(), report({ 'ts-0001': 2 }))[0]).toBe(
        'the code and the vectors are the same, and the result is not: it is not deterministic',
      )
    })

    it('does not forgive a deep rank, which only other vectors can explain, and names it', () => {
      expect(differencesOf(report({ 'ts-0001': 20 }), report({ 'ts-0001': 21 }))).toContain(
        'result.strategies.0.questions.0.primaryRank: report 20, now 21',
      )
    })

    it('names a field that is new, when no conclusion changed', () => {
      const after = report()
      const [strategy] = after.result.strategies
      if (strategy === undefined) throw new Error('no strategy')
      Object.assign(strategy, { extra: 1 })

      expect(differencesOf(report(), after)).toEqual([
        'the code and the vectors are the same, and the result is not: it is not deterministic',
        'result.strategies.0.extra: report undefined, now 1',
      ])
    })

    it('leaves the field paths out when it can name a conclusion instead', () => {
      expect(differencesOf(report(), report({ 'ts-0001': 2 })).join('\n')).not.toContain(
        'result.strategies',
      )
    })
  })

  it('does not blame the search for a targets file or a lock that changed', () => {
    const before = report()
    const target = {
      questionId: 'ts-0001',
      anchor: 'ts-0001.md',
      target: 1,
      ranks: { hybrid: 1 },
      met: true,
    }
    const after = report()
    after.result.targets = [target]
    after.result.review = ['ts-0002']

    expect(verifyReport(before, after)).toEqual({
      status: 'identical',
      changedVectors: [],
      notes: ['the target ts-0001 ts-0001.md <= 1 is new'],
    })
    expect(verifyReport(after, before)).toEqual({
      status: 'identical',
      changedVectors: [],
      notes: ['the target ts-0001 ts-0001.md <= 1 is no longer in the file'],
    })
  })

  describe('with other vectors', () => {
    it('calls a move below the context equivalent, and says what moved', () => {
      const verification = verifyReport(
        report({ 'ts-0001': 20 }),
        otherVectors(report({ 'ts-0001': 21 })),
      )

      expect(verification).toEqual({
        status: 'equivalent',
        changedVectors: ['query', 'corpus'],
        moved: ['hybrid ts-0001'],
        notes: [],
      })
    })

    it('names only the vectors that changed', () => {
      const verification = verifyReport(
        report({ 'ts-0001': 20 }),
        otherVectors(report({ 'ts-0001': 21 }), 'q2', 'c'),
      )

      expect(verification).toMatchObject({ changedVectors: ['query'] })
    })

    it.each([
      ['another commit', { repoSha: 'other' }],
      ['a dirty tree now', { repoDirty: true }],
    ])('calls it inconclusive at %s, since code and vectors cannot be told apart', (_n, run) => {
      const now = otherVectors(report({ 'ts-0001': 21 }))
      now.run = { ...now.run, ...run }

      expect(verifyReport(report({ 'ts-0001': 20 }), now).status).toBe('inconclusive')
    })

    it('calls it inconclusive when the report itself came from a dirty tree', () => {
      const before = report({ 'ts-0001': 20 })
      before.run.repoDirty = true

      expect(verifyReport(before, otherVectors(report({ 'ts-0001': 21 }))).status).toBe(
        'inconclusive',
      )
    })

    it('calls a move across a cutoff different, and names the count', () => {
      const differences = differencesOf(
        report({ 'ts-0001': 8 }),
        otherVectors(report({ 'ts-0001': 9 })),
      )

      expect(differences).toContain('hybrid overall primary hit@8: report 40, now 39')
      expect(differences).toContain('hybrid overall recall@8: report 1, now 0.975')
      expect(differences).toContain('hybrid basic primary hit@8: report 40, now 39')
    })

    it('looks at acceptable anchors too, apart from primary ones', () => {
      const differences = differencesOf(
        report({}, { acceptable: { 'ts-0001': 2 } }),
        otherVectors(report({}, { acceptable: { 'ts-0001': 3 } })),
      )

      expect(differences).toContain('hybrid ts-0001: ts-0001-alt.md from rank 2 to 3')
    })

    it('compares the totals for acceptable anchors as well, not only their ranks', () => {
      const after = otherVectors(report())
      const [strategy] = after.result.strategies
      if (strategy === undefined) throw new Error('no strategy')
      strategy.overall.withAcceptable.hits[1] = 39

      expect(differencesOf(report(), after)).toEqual([
        'hybrid overall withAcceptable hit@1: report 40, now 39',
      ])
    })

    it('catches two questions trading places, which leaves every count the same', () => {
      const differences = differencesOf(
        report({ 'ts-0001': 2, 'ts-0002': 20 }),
        otherVectors(report({ 'ts-0001': 20, 'ts-0002': 2 })),
      )

      expect(differences).toContain('hybrid ts-0001: ts-0001.md from rank 2 to 20')
      expect(differences).toContain('hybrid ts-0002: ts-0002.md from rank 20 to 2')
    })

    it('calls any change inside the context different, even with every anchor in place', () => {
      const after = otherVectors(report())
      const question = after.result.strategies[0]?.questions[0]
      if (question === undefined) throw new Error('no question')
      question.context = ['another-chunk']

      expect(differencesOf(report(), after)).toEqual(['hybrid ts-0001: the context changed'])
    })

    it('calls a flipped verdict different, even when only a deep rank moved', () => {
      const scores = (rank: number) => IDS.map((id, i) => score(id, i === 0 ? rank : 1))
      const compared = (verdict: 'a' | 'not-significant'): EvalComparison => {
        const base = compareScores(
          { name: 'vector', questions: scores(30) },
          { name: 'hybrid', questions: scores(30) },
        )
        const [scope] = base.scopes
        const [first] = scope?.primary ?? []
        if (scope === undefined || first === undefined) throw new Error('no scope')
        return { ...base, scopes: [{ ...scope, primary: [{ ...first, verdict }] }] }
      }

      const differences = differencesOf(
        report({ 'ts-0001': 30 }, { comparison: compared('a') }),
        otherVectors(report({ 'ts-0001': 32 }, { comparison: compared('not-significant') })),
      )

      expect(differences).toEqual([
        'comparison overall primary hit@1: verdict a, now not-significant',
      ])
    })

    it('calls a target that flipped different', () => {
      const target = {
        questionId: 'ts-0001',
        anchor: 'ts-0001.md',
        target: 8,
        ranks: { hybrid: 8 },
        met: true,
      }
      const before = report()
      before.result.targets = [target]
      const after = otherVectors(report())
      after.result.targets = [{ ...target, met: false }]

      expect(differencesOf(before, after)).toEqual([
        'target ts-0001 ts-0001.md <= 8: met true, now false',
      ])
    })

    it('notices a tag that vanished, and one that appeared', () => {
      const before = report()
      const after = otherVectors(report())
      const [strategy] = after.result.strategies
      if (strategy === undefined) throw new Error('no strategy')
      const { basic } = strategy.byTag
      if (basic === undefined) throw new Error('no tag')
      strategy.byTag = { other: basic }

      const differences = differencesOf(before, after)

      expect(differences).toContain('hybrid basic: gone')
      expect(differences).toContain('hybrid other: new')
    })

    it('notices a question no longer scored, and a strategy that did not run', () => {
      const after = otherVectors(report())
      const [strategy] = after.result.strategies
      strategy?.questions.pop()

      expect(differencesOf(report(), after)).toContain('hybrid ts-0040: no longer scored')

      const none = otherVectors(report())
      none.result.strategies = []
      expect(differencesOf(report(), none)).toEqual(['hybrid: did not run'])
    })
  })
})
