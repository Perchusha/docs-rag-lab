import type {
  AnswerRow,
  EvalAnswer,
  EvalAnswers,
  EvalCalibration,
  EvalQuestionScore,
  EvalReport,
  EvalSpotCheck,
  EvalSupport,
  EvalVerdict,
  EvalVerifyRecord,
} from '@docs-rag-lab/contracts'
import { EVAL_REPORT_VERSION } from '@docs-rag-lab/contracts'
import { describe, expect, it } from 'vitest'

import { compareScores } from './compare.ts'
import {
  againstItself,
  buildDashboardDetails,
  buildDashboardRun,
  compareDashboardRuns,
  meanFigure,
  shareFigure,
  splitOf,
} from './dashboard.ts'
import { parseGoldenSet } from './golden.ts'
import { strategyResult } from './metrics.ts'

const ID = (i: number): string => `ts-${String(i).padStart(4, '0')}`

const score = (id: string, rank: number | null, tags = ['basic']): EvalQuestionScore => ({
  id,
  tags,
  anchors: [{ anchor: `${id}.md`, role: 'primary', rank }],
  primaryRank: rank,
  acceptableRank: rank,
  recallAt8: rank !== null && rank <= 8 ? 1 : 0,
  context: [],
})

function answer(i: number, row: AnswerRow, overrides: Partial<EvalAnswer> = {}): EvalAnswer {
  return {
    questionId: ID(i),
    row,
    sample: 1,
    status: 'ok',
    model: 'm',
    stopReason: 'end_turn',
    text: 'T',
    blocks: [],
    claims: [],
    context: [],
    inputTokens: 1,
    outputTokens: 1,
    costUsd: 0.01,
    latencyMs: 2000,
    firstTokenMs: 1,
    fromCache: false,
    ...overrides,
  }
}

function verdict(
  i: number,
  row: AnswerRow,
  correctness: 0 | 1 | 2 | null,
  overrides: Partial<EvalVerdict> = {},
): EvalVerdict {
  return {
    questionId: ID(i),
    row,
    sample: 1,
    judgeSample: 1,
    status: 'ok',
    reasoning: 'r',
    correctness,
    falseRefusal: correctness === null ? null : false,
    outcome: null,
    costUsd: 0,
    ...overrides,
  }
}

const support = (i: number, row: AnswerRow, ...values: boolean[]): EvalSupport => ({
  questionId: ID(i),
  row,
  sample: 1,
  status: 'ok',
  claims: values.map((supported) => ({ supported, reason: 'r' })),
  costUsd: 0,
})

const metrics = (overrides: object = {}) => ({
  questions: 10,
  correctness: 1,
  scores: [0, 0, 10] as [number, number, number],
  falseRefusals: 0,
  citationAccuracy: { cited: 10, hit: 9 },
  support: { claims: 10, supported: 10 },
  correctAndGrounded: 7,
  meanLatencyMs: 1,
  meanInputTokens: 1,
  meanOutputTokens: 1,
  meanCostUsd: 1,
  ...overrides,
})

const rowResult = (row: AnswerRow, sample = 1) => ({
  row,
  sample,
  overall: metrics(),
  byTag: {},
  refusals: { questions: 1, correct: 1, hallucinations: 0, wrong: 0 },
  excluded: { truncated: [], refused: [], failed: [], unjudged: [] },
})

function answersFixture(overrides: Partial<EvalAnswers> = {}): EvalAnswers {
  return {
    models: { answer: 'a', judge: 'j' },
    prompts: { correctness: 'c1', refusal: 'r1', support: 's1' },
    rows: [rowResult(0), rowResult(2), rowResult(3)],
    comparisons: [],
    judgeRetest: null,
    candidates: [],
    paidUsd: 0,
    answers: [],
    verdicts: [],
    support: [],
    ...overrides,
  }
}

function report(
  overrides: { answers?: EvalAnswers; vector?: (number | null)[]; hybrid?: (number | null)[] } = {},
): EvalReport {
  const vector = overrides.vector ?? Array.from({ length: 10 }, () => 1)
  const hybrid = overrides.hybrid ?? Array.from({ length: 10 }, () => 2)
  const scores = (ranks: (number | null)[], name: 'vector' | 'hybrid') =>
    strategyResult(
      name,
      ranks.map((rank, i) => score(ID(i + 1), rank, i < 2 ? ['basic', 'edge'] : ['basic'])),
    )
  const strategies = [scores(vector, 'vector'), scores(hybrid, 'hybrid')]
  const [a, b] = strategies
  if (a === undefined || b === undefined) throw new Error('no strategies')
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
      goldenSet: { version: 1, hash: 'set-hash' },
      retrievalVersion: 1,
      retrieval: { topK: 8 },
    },
    vectors: { queryHash: 'q', corpusHash: 'c' },
    result: {
      scored: vector.length,
      stale: [],
      review: [],
      unanswerable: [ID(41)],
      strategies,
      comparison: compareScores(
        { name: 'vector', questions: a.questions },
        { name: 'hybrid', questions: b.questions },
      ),
      targets: [],
      chunks: {},
    },
    run: {
      name: 'answers',
      createdAt: '2026-11-03T00:00:00.000Z',
      repoSha: 'abcdef1234567890',
      repoDirty: false,
      timings: {},
      usage: { embeddingTokens: 0, embeddingRequests: 0 },
    },
    ...(overrides.answers === undefined ? {} : { answers: overrides.answers }),
  }
}

const build = (value: EvalReport, calibrations: EvalCalibration[] = []) =>
  buildDashboardRun({
    id: 'run-id',
    report: value,
    calibrations,
    verify: null,
    indexDocsSha: 'docs-sha',
  })

/** A report with the reranker: its retrieval, and any answers. */
function withRerank(
  overrides: {
    answers?: EvalAnswers
    hybrid?: (number | null)[]
    rerank?: (number | null)[]
  } = {},
): EvalReport {
  const hybrid = overrides.hybrid ?? Array.from({ length: 10 }, () => 3)
  const ranks = overrides.rerank ?? Array.from({ length: 10 }, () => 1)
  const base = report({
    hybrid,
    ...(overrides.answers === undefined ? {} : { answers: overrides.answers }),
  })
  return {
    ...base,
    identity: { ...base.identity, rerank: { model: 'rerank-test', depth: 20 } },
    result: {
      ...base.result,
      strategies: [
        ...base.result.strategies,
        strategyResult(
          'rerank',
          ranks.map((rank, i) => score(ID(i + 1), rank, i < 2 ? ['basic', 'edge'] : ['basic'])),
        ),
      ],
    },
  }
}

const contextualResult = (ranks: (number | null)[] = Array.from({ length: 10 }, () => 1)) =>
  strategyResult(
    'rerank',
    ranks.map((rank, i) => score(ID(i + 1), rank, i < 2 ? ['basic', 'edge'] : ['basic'])),
  )

const INDEX = { rows: [5] as AnswerRow[], contextModel: 'haiku:abc', chunksHash: 'contextual' }

/** Every row answers the same, and the two later rows answer twice, unless told otherwise. */
function ladderAnswers(
  score4: (i: number) => 0 | 1 | 2 = () => 2,
  overrides: Partial<EvalAnswers> = {},
): EvalAnswers {
  const ids = [1, 2, 3, 4, 5, 6, 7, 8]
  const rows: AnswerRow[] = [0, 2, 3, 4, 5]
  const sampled = (row: AnswerRow): number[] => (row === 0 || row === 2 ? [1] : [1, 2])
  return answersFixture({
    rows: rows.flatMap((row) => sampled(row).map((sample) => rowResult(row, sample))),
    answers: ids.flatMap((i) =>
      rows.flatMap((row) => sampled(row).map((sample) => answer(i, row, { sample }))),
    ),
    verdicts: ids.flatMap((i) =>
      rows.flatMap((row) =>
        sampled(row).map((sample) => verdict(i, row, row === 4 ? score4(i) : 2, { sample })),
      ),
    ),
    support: ids.flatMap((i) =>
      rows
        .filter((row) => row !== 0)
        .flatMap((row) => sampled(row).map((sample) => ({ ...support(i, row, true), sample }))),
    ),
    contextualIndex: INDEX,
    ...overrides,
  })
}

describe('a report with row 7, hybrid on the compiled index (ADR-0017)', () => {
  const COMPILED_INDEX = {
    rows: [7] as AnswerRow[],
    compiler: 'compiler:twoslash test',
    chunksHash: 'compiled',
  }
  /** Rows 3 and 7 answer twice; row 3 scores what it is told, and the others 2. */
  const compiledAnswers = (score3: (i: number) => 0 | 1 | 2 = () => 2): EvalAnswers => {
    const ids = [1, 2, 3, 4, 5, 6, 7, 8]
    const rows: AnswerRow[] = [0, 2, 3, 7]
    const sampled = (row: AnswerRow): number[] => (row === 3 || row === 7 ? [1, 2] : [1])
    return answersFixture({
      rows: rows.flatMap((row) => sampled(row).map((sample) => rowResult(row, sample))),
      answers: ids.flatMap((i) =>
        rows.flatMap((row) => sampled(row).map((sample) => answer(i, row, { sample }))),
      ),
      verdicts: ids.flatMap((i) =>
        rows.flatMap((row) =>
          sampled(row).map((sample) => verdict(i, row, row === 3 ? score3(i) : 2, { sample })),
        ),
      ),
      support: ids.flatMap((i) =>
        rows
          .filter((row) => row !== 0)
          .flatMap((row) => sampled(row).map((sample) => ({ ...support(i, row, true), sample }))),
      ),
      compiledIndex: COMPILED_INDEX,
    })
  }
  const compiledHybrid = strategyResult(
    'hybrid',
    Array.from({ length: 10 }, (_, i) => score(ID(i + 1), 1)),
  )
  const run = (
    answers: EvalAnswers,
    compiled: typeof compiledHybrid | undefined = compiledHybrid,
  ) =>
    buildDashboardRun({
      id: 'run-id',
      report: report({ hybrid: Array.from({ length: 10 }, () => 3), answers }),
      compiled,
      calibrations: [],
      verify: null,
      indexDocsSha: 'docs-sha',
    })

  it('asks whether the compiled index finds the right chunks higher, against hybrid', () => {
    const { retrieval } = run(compiledAnswers())

    expect(retrieval.question).toBe('Does the compiled index find the right chunks higher?')
    expect(retrieval.columns).toEqual(['Hybrid', 'Hybrid, compiled'])
    expect(retrieval.rows[0]?.comparisons).toMatchObject([
      { a: 'Hybrid', b: 'Hybrid, compiled', aAhead: 0, bAhead: 10, verdict: 'b' },
    ])
  })

  it('says the compiled retrieval is in a report of its own when that report is missing', () => {
    const { retrieval } = buildDashboardRun({
      id: 'run-id',
      report: report({ hybrid: Array.from({ length: 10 }, () => 3), answers: compiledAnswers() }),
      calibrations: [],
      verify: null,
      indexDocsSha: 'docs-sha',
    })

    expect(retrieval.rows[0]?.figures[1]).toEqual({ kind: 'none', reason: 'in its own report' })
  })

  it('compares row 3 with row 7, and keeps the app on the plain index when nothing names row 7', () => {
    const { answers } = run(compiledAnswers())

    expect(answers?.question).toBe('Does that reach the answers?')
    expect(answers?.columns).toEqual(['Hybrid', 'Hybrid, compiled'])
    expect(answers?.summary).toContain('No difference from the plain index holds up.')
    expect(answers?.notes).toContain(
      'The app stays on the plain index: no verdict names the compiled one (ADR-0017).',
    )
  })

  it('does not say so when a verdict names row 7', () => {
    const { answers } = run(compiledAnswers(() => 1))

    expect(answers?.rows[0]?.comparisons).toMatchObject([{ verdict: 'b' }])
    expect(answers?.notes?.join(' ') ?? '').not.toContain('stays on the plain index')
  })

  it('names the compiled index and its compiler in the trust section', () => {
    expect(run(compiledAnswers()).trust.index).toBe(
      'Hybrid, compiled read the compiled index: compiler:twoslash test.',
    )
  })
})

describe('a report with the reranker', () => {
  const buildWith = (value: EvalReport, contextual?: ReturnType<typeof contextualResult>) =>
    buildDashboardRun({
      id: 'run-id',
      report: value,
      contextual,
      calibrations: [],
      verify: null,
      indexDocsSha: 'docs-sha',
    })

  describe('its retrieval', () => {
    it('asks about the reranker, against hybrid, with vector out of the first screen', () => {
      const { retrieval } = buildWith(withRerank())

      expect(retrieval.question).toBe('Does rerank find the right chunks higher?')
      expect(retrieval.columns).toEqual(['Hybrid', 'Rerank'])
      expect(retrieval.against).toBe('Hybrid')
      expect(retrieval.rows.map(({ id }) => id)).toEqual(['top-1', 'top-8', 'mrr'])
      expect(retrieval.showRunToRun).toBe(false)
    })

    it('compares each measure with hybrid, and says what the verdicts name', () => {
      const { retrieval } = buildWith(withRerank())

      expect(retrieval.rows[0]?.comparisons).toMatchObject([
        { a: 'Hybrid', b: 'Rerank', aAhead: 0, bAhead: 10, verdict: 'b' },
      ])
      expect(retrieval.summary).toContain('Rerank better on the right chunk first')
      expect(retrieval.summary).toContain('Rerank is hybrid, then rerank-test over its top 20.')
    })

    it('says no difference holds up when none does', () => {
      const same = Array.from({ length: 10 }, () => 1)
      const { retrieval } = buildWith(withRerank({ hybrid: same, rerank: same }))

      expect(retrieval.summary).toContain(
        'No difference from hybrid holds up on these 10 questions.',
      )
    })

    it('takes row 5 from the report of its own index, and names it short where room is short', () => {
      const answers = ladderAnswers()
      const { retrieval } = buildWith(withRerank({ answers }), contextualResult())

      expect(retrieval.columns).toEqual(['Hybrid', 'Rerank', 'Rerank + contexts'])
      expect(retrieval.rows[0]?.figures[2]).toMatchObject({ kind: 'share', count: 10, of: 10 })
      expect(retrieval.rows[0]?.comparisons[1]).toMatchObject({
        b: 'Rerank + contexts',
        shortB: '+ contexts',
        verdict: 'b',
      })
    })

    it('says in three words that row 5 claims the same, and that the two do not differ', () => {
      const { retrieval } = buildWith(withRerank({ answers: ladderAnswers() }), contextualResult())

      expect(retrieval.summary).toContain('So is rerank + contexts.')
      expect(retrieval.summary).toContain('Between those two, no difference holds up.')
    })

    it('names what row 5 claims in full when that differs', () => {
      const flat = Array.from({ length: 10 }, () => 3)
      const { retrieval } = buildWith(
        withRerank({ answers: ladderAnswers() }),
        contextualResult(flat),
      )

      expect(retrieval.summary).not.toContain('So is')
      expect(retrieval.summary).toContain('Rerank better on')
      expect(retrieval.summary).toContain('Rerank better on')
    })

    it('says where row 5 is when its report cannot be found, and compares nothing', () => {
      const { retrieval } = buildWith(withRerank({ answers: ladderAnswers() }))

      expect(retrieval.rows[0]?.figures[2]).toEqual({ kind: 'none', reason: 'in its own report' })
      expect(retrieval.rows[0]?.comparisons).toHaveLength(1)
    })

    it('leaves a report with no reranker as it was', () => {
      const { retrieval } = build(report())

      expect(retrieval.question).toBe('Does hybrid find the right chunks more often?')
      expect(retrieval.against).toBeUndefined()
      expect(retrieval.rows.map(({ id }) => id)).toEqual(['top-8', 'mrr'])
    })
  })

  describe('its answers', () => {
    const answersOf = (value: EvalAnswers = ladderAnswers(), hybridRanks?: (number | null)[]) => {
      const { answers } = buildWith(
        withRerank({
          answers: value,
          ...(hybridRanks === undefined ? {} : { hybrid: hybridRanks }),
        }),
        contextualResult(),
      )
      if (answers === null) throw new Error('no answers')
      return answers
    }

    it('asks whether the gain reaches the answers, over three columns and four rows', () => {
      const answers = answersOf()

      expect(answers.question).toBe('Does that reach the answers?')
      expect(answers.columns).toEqual(['Hybrid', 'Rerank', 'Rerank + contexts'])
      expect(answers.against).toBe('Hybrid')
      expect(answers.rows.map(({ id }) => id)).toEqual([
        'fully-correct',
        'citations-hold',
        'false-refusals',
        'correct-and-grounded',
      ])
    })

    it('keeps a run to run per column, under its own header', () => {
      const answers = answersOf()

      expect(answers.showRunToRun).toBe(true)
      expect(answers.runToRunHeader).toBe('Run to run (each twice)')
      expect(answers.rows[0]?.runToRuns).toEqual([0, 0, 0])
    })

    it('holds a verdict to the larger run to run of its two sides', () => {
      // Row 4 is ahead of row 3 on nothing, and behind it on 6 of 8.
      const low = (i: number): 0 | 1 | 2 => (i <= 6 ? 1 : 2)
      const steady = ladderAnswers(low)
      const shaky = ladderAnswers(low, {
        verdicts: steady.verdicts.map((item) =>
          item.row === 4 && item.sample === 2 && item.questionId === ID(1)
            ? { ...item, correctness: 2 as const }
            : item.row === 4 && item.sample === 2 && item.questionId === ID(2)
              ? { ...item, correctness: 2 as const }
              : item.row === 4 && item.sample === 2 && item.questionId === ID(3)
                ? { ...item, correctness: 2 as const }
                : item,
        ),
      })

      expect(answersOf(steady).rows[0]?.comparisons[0]).toMatchObject({ verdict: 'a' })
      const moved = answersOf(shaky).rows[0]
      expect(moved?.runToRuns).toEqual([0, 3, 0])
      expect(moved?.comparisons[0]).toMatchObject({ aAhead: 6, bAhead: 0, verdict: 'noise' })
    })

    it('says that no difference holds up, also between the two later rows', () => {
      expect(answersOf().summary).toContain(
        'No difference from hybrid holds up, and none between rerank and rerank + contexts.',
      )
    })

    it('says what a verdict names', () => {
      const answers = answersOf(ladderAnswers((i) => (i <= 6 ? 1 : 2)))

      expect(answers.summary).toContain('Hybrid better on fully correct')
    })

    it('gives the reference without docs, with its interval and what the labels say of it', () => {
      expect(answersOf().notes?.[0]).toMatch(
        /^Without docs: 8 of 8 fully correct \(\d+-100%\), not calibrated\.$/,
      )
    })

    it('says the app stays on hybrid when the gain did not reach the answers', () => {
      expect(answersOf().notes?.[1]).toBe(
        'The app stays on hybrid, because the retrieval gain did not reach the answers (ADR-0014).',
      )
    })

    it('takes the reason from the source, when it gives one, and says who drafted the set', () => {
      const run = buildDashboardRun({
        id: 'run-id',
        report: withRerank({ answers: ladderAnswers() }),
        calibrations: [],
        verify: null,
        indexDocsSha: 'docs-sha',
        contextual: contextualResult(),
        about: { set: 'Claude drafted it.', staysOnHybrid: 'Because of R3.' },
      })

      expect(run.answers?.notes?.[1]).toBe('Because of R3.')
      expect(run.trust.goldenSet.about).toBe('Claude drafted it.')
    })

    it('adds nothing to the set when the source says nothing', () => {
      const run = buildDashboardRun({
        id: 'run-id',
        report: withRerank({ answers: ladderAnswers() }),
        calibrations: [],
        verify: null,
        indexDocsSha: 'docs-sha',
        contextual: contextualResult(),
        about: {},
      })

      expect(Object.keys(run.trust.goldenSet)).toEqual(['version', 'hash'])
    })

    it('does not say so when an answer row is named better', () => {
      const better = ladderAnswers(() => 2, {
        verdicts: ladderAnswers().verdicts.map((item) =>
          item.row === 3 ? { ...item, correctness: 1 as const } : item,
        ),
      })

      expect(answersOf(better).notes?.join(' ')).not.toContain('The app stays on hybrid')
    })

    it('does not say so when retrieval gained nothing', () => {
      const same = Array.from({ length: 10 }, () => 1)
      const { answers } = buildWith(
        withRerank({ answers: ladderAnswers(), hybrid: same, rerank: same }),
        contextualResult(same),
      )

      expect(answers?.notes?.join(' ')).not.toContain('The app stays on hybrid')
    })

    it('says in the trust section which index row 5 read', () => {
      const { trust } = buildWith(withRerank({ answers: ladderAnswers() }), contextualResult())

      expect(trust.index).toBe('Rerank + contexts read the contextual index: haiku:abc.')
    })
  })

  describe('with no row 5, as on a source that does not measure it', () => {
    const noRow5 = (): EvalAnswers => {
      const all = ladderAnswers()
      const without = <T extends { row: AnswerRow }>(items: readonly T[]): T[] =>
        items.filter(({ row }) => row !== 5)
      const answers: EvalAnswers = {
        ...all,
        rows: without(all.rows),
        answers: without(all.answers),
        verdicts: without(all.verdicts),
        support: without(all.support),
      }
      delete answers.contextualIndex
      return answers
    }

    it('has two columns on the first screen, and says nothing of contexts', () => {
      const { retrieval, answers, trust } = buildWith(withRerank({ answers: noRow5() }))

      expect(retrieval.columns).toEqual(['Hybrid', 'Rerank'])
      expect(answers?.columns).toEqual(['Hybrid', 'Rerank'])
      expect(answers?.rows[0]?.comparisons.map(({ b }) => b)).toEqual(['Rerank'])
      expect(JSON.stringify([retrieval, answers]).toLowerCase()).not.toContain('contexts')
      expect(trust.index).toBeUndefined()
    })

    it('still gives the reference without docs, and why the app stays on hybrid', () => {
      const { answers } = buildWith(withRerank({ answers: noRow5() }))

      expect(answers?.notes?.[0]).toMatch(/^Without docs: 8 of 8 fully correct/)
      expect(answers?.notes?.[1]).toContain('The app stays on hybrid')
    })
  })

  describe('a spot check', () => {
    const spot: EvalSpotCheck = {
      report: { repoSha: 'x', name: 'final', createdAt: 'then' },
      prompts: {},
      judgeModel: 'j',
      correctnessDisagreements: [{ questionId: ID(1), row: 3, human: 1, judge: 2 }],
      supportDisagreements: [],
      labelled: 10,
      agreement: [
        {
          dimension: 'correctness',
          agreed: 7,
          compared: 8,
          kappa: 0.5,
          interval: [0.5, 1],
          passed: true,
        },
      ],
      unanswerableOnly: { compared: 2, agreed: 2 },
      allowed: 1,
      passed: true,
    }
    const build = (spotCheck: EvalSpotCheck | null) =>
      buildDashboardRun({
        id: 'run-id',
        report: withRerank({ answers: ladderAnswers() }),
        calibrations: [],
        verify: null,
        spotCheck,
        indexDocsSha: 'docs-sha',
      }).trust

    it('goes in the trust section, with which way it leans', () => {
      expect(build(spot).spotCheck).toMatchObject({
        passed: true,
        labelled: 10,
        allowed: 1,
        bias: 'The 1 disagreement is the judge scoring higher than the human: correctness may be slightly inflated.',
      })
    })

    it('adds nothing for a report that has none, and changes no calibration', () => {
      const without = build(null)

      expect(without).not.toHaveProperty('spotCheck')
      expect(build(spot).judge).toEqual(without.judge)
    })
  })

  describe('its details', () => {
    const detailsOf = (value: EvalReport, contextual?: ReturnType<typeof contextualResult>) =>
      buildDashboardDetails({ report: value, questions, contextual, calibrations: [] })
    const questions = parseGoldenSet(
      JSON.stringify({
        id: ID(1),
        question: 'Q?',
        answer: 'A.',
        primary: ['a.md'],
        tags: ['basic'],
      }),
    )

    it('has every strategy and row behind the first screen', () => {
      const details = detailsOf(withRerank({ answers: ladderAnswers() }), contextualResult())

      expect(details.allRows?.map(({ columns }) => columns)).toEqual([
        ['Vector', 'Hybrid', 'Rerank', 'Rerank + contexts'],
        ['No RAG', 'Vector', 'Hybrid', 'Rerank', 'Rerank + contexts'],
      ])
      const answers = details.allRows?.[1]
      expect(answers?.rows.map(({ id }) => id)).toEqual([
        'fully-correct',
        'citations-hold',
        'correct-and-grounded',
        'cites-anchor',
        'false-refusals',
        'right-refusals',
        'time-and-cost',
      ])
      expect(answers?.rows[0]?.runToRuns).toEqual([null, null, 0, 0, 0])
      expect(answers?.rows.at(-1)?.note).toBe('search not included')
      expect(answers?.rows[0]?.comparisons.map(({ a, b }) => [a, b])).toEqual([
        ['No RAG', 'Hybrid'],
        ['Vector', 'Hybrid'],
        ['Hybrid', 'Rerank'],
        ['Hybrid', 'Rerank + contexts'],
        ['Rerank', 'Rerank + contexts'],
      ])
    })

    it('has only retrieval for a report with no answers', () => {
      const details = detailsOf(withRerank())

      expect(details.allRows?.map(({ columns }) => columns)).toEqual([
        ['Vector', 'Hybrid', 'Rerank'],
      ])
    })

    it('has no such thing for a report with no reranker', () => {
      expect(detailsOf(report()).allRows).toBeUndefined()
    })

    it('adds the later rows to the tags and to each question', () => {
      const details = detailsOf(withRerank({ answers: ladderAnswers() }), contextualResult())

      const top8 = details.tags.find(({ question }) => question.startsWith('Right chunk in top 8'))
      expect(top8?.columns).toEqual(['Vector', 'Hybrid', 'Rerank', 'Rerank + contexts'])
      expect(top8?.rows[0]?.comparisons.map(({ a, b }) => [a, b])).toEqual([
        ['Vector', 'Hybrid'],
        ['Hybrid', 'Rerank'],
        ['Hybrid', 'Rerank + contexts'],
      ])
      const fully = details.tags.find(({ question }) => question === 'Fully correct, by tag')
      expect(fully?.runToRunHeader).toBe('Run to run')
      expect(fully?.rows[0]?.runToRuns).toEqual([null, null, 0, 0, 0])
      expect(details.questions[0]?.ranks.map(({ column }) => column)).toEqual([
        'Vector',
        'Hybrid',
        'Rerank',
        'Rerank + contexts',
      ])
      expect(details.questions[0]?.answers.map(({ column }) => column)).toEqual([
        'No RAG',
        'Vector',
        'Hybrid',
        'Rerank',
        'Rerank + contexts',
      ])
    })
  })

  it('says in the trust section when a report measured another index', () => {
    const base = withRerank()
    const { trust } = buildWith({
      ...base,
      identity: { ...base.identity, contextModel: 'heading-prefix:1' },
    })

    expect(trust.index).toBe(
      'This run measured another index than the plain one: heading-prefix:1.',
    )
    expect(build(report()).trust.index).toBeUndefined()
  })
})

describe('figures', () => {
  it('gives a share a Wilson interval', () => {
    const figure = shareFigure(36, 40)

    expect(figure).toMatchObject({ kind: 'share', count: 36, of: 40 })
    if (figure.kind !== 'share') throw new Error('not a share')
    expect(figure.low).toBeCloseTo(0.77, 2)
    expect(figure.high).toBeCloseTo(0.96, 2)
  })

  it('gives a mean a bootstrap interval that stays in range', () => {
    const figure = meanFigure([...Array.from({ length: 39 }, () => 1), 0])

    if (figure.kind !== 'mean') throw new Error('not a mean')
    expect(figure.value).toBeCloseTo(0.975)
    expect(figure.high).toBeLessThanOrEqual(1)
  })

  it('keeps the top of the scale with a mean, for what is not out of 1', () => {
    expect(meanFigure([1, 2, 2], 2)).toMatchObject({ kind: 'mean', max: 2 })
    expect(meanFigure([1, 0])).toMatchObject({ max: 1 })
  })

  it('shows no number for nothing, rather than 0.000 or 0 of 0', () => {
    expect(meanFigure([])).toEqual({ kind: 'none', reason: 'none to count' })
    expect(shareFigure(0, 0)).toEqual({ kind: 'none', reason: 'none to count' })
  })
})

describe('againstItself', () => {
  const split = (aAhead: number, bAhead: number, verdict: 'a' | 'b' | 'mixed' = 'a') => ({
    a: 'A',
    b: 'B',
    aAhead,
    bAhead,
    tied: 0,
    p: 0.01,
    verdict,
  })

  it('leaves a verdict alone with no second run to compare it with', () => {
    expect(againstItself(split(8, 0), null).verdict).toBe('a')
  })

  it('calls a margin noise up to twice what a row moves against itself', () => {
    expect(againstItself(split(8, 0), 4).verdict).toBe('noise')
    expect(againstItself(split(0, 8, 'b'), 4).verdict).toBe('noise')
    expect(againstItself(split(9, 0), 4).verdict).toBe('a')
  })

  it('touches only a verdict that names a side', () => {
    expect(againstItself(split(8, 0, 'mixed'), 6).verdict).toBe('mixed')
  })
})

describe('splitOf', () => {
  const values = (...entries: [string, number][]) => new Map(entries)

  it('keeps each side with its own wins, over the questions both have', () => {
    expect(
      splitOf(
        'A',
        values(['q1', 1], ['q2', 1], ['q3', 0], ['only-a', 1]),
        'B',
        values(['q1', 0], ['q2', 1], ['q3', 1], ['only-b', 0]),
      ),
    ).toMatchObject({ a: 'A', b: 'B', aAhead: 1, bAhead: 1, tied: 1, verdict: 'too-few' })
  })

  it('names a winner only past what chance explains', () => {
    const win = values(
      ...Array.from({ length: 8 }, (_, i): [string, number] => [`q${String(i)}`, 1]),
    )
    const loss = values(
      ...Array.from({ length: 8 }, (_, i): [string, number] => [`q${String(i)}`, 0]),
    )

    expect(splitOf('A', win, 'B', loss).verdict).toBe('a')
    expect(splitOf('A', loss, 'B', win).verdict).toBe('b')
  })
})

describe('buildDashboardRun', () => {
  it('asks the retrieval question with retrieval numbers alone', () => {
    const { retrieval, answers } = build(report())

    expect(retrieval.question).toBe('Does hybrid find the right chunks more often?')
    expect(retrieval.columns).toEqual(['Vector', 'Hybrid'])
    expect(retrieval.rows.map(({ label }) => label)).toEqual([
      'Right chunk in top 8',
      'How high it ranks (MRR)',
    ])
    expect(retrieval.showRunToRun).toBe(false)
    expect(answers).toBeNull()
  })

  it('takes retrieval numbers and verdicts from the report, each on its own side', () => {
    const { retrieval } = build(
      report({ vector: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1], hybrid: [9, 9, 9, 9, 9, 9, 9, 9, 1, 1] }),
    )
    const [top8] = retrieval.rows

    expect(top8?.figures[0]).toMatchObject({ count: 10, of: 10 })
    expect(top8?.figures[1]).toMatchObject({ count: 2, of: 10 })
    expect(top8?.comparisons[0]).toMatchObject({
      a: 'Vector',
      b: 'Hybrid',
      aAhead: 8,
      bAhead: 0,
      tied: 2,
      verdict: 'a',
    })
    expect(retrieval.summary).toBe(
      'Vector better on right chunk in top 8 and how high it ranks (MRR).',
    )
  })

  it('says a mixed verdict is mixed, rather than that nothing holds up', () => {
    const value = report({
      vector: [2, 2, 2, 2, 2, 2, 2, 2, 2, null],
      hybrid: [3, 3, 3, 3, 3, 3, 3, 3, 3, 1],
    })
    const scope = value.result.comparison?.scopes.find((item) => item.scope === 'overall')
    for (const difference of scope?.primary ?? []) {
      if (difference.metric === 'mrr') difference.verdict = 'mixed'
    }

    expect(build(value).retrieval.summary).toContain('Mixed on how high it ranks (MRR).')
  })

  it('says too few rather than that nothing holds up', () => {
    const same = [1, 1, 1]

    expect(build(report({ vector: same, hybrid: same })).retrieval.summary).toBe(
      'Too few questions to say.',
    )
  })

  it('claims nothing for a run of one strategy', () => {
    const value = report()
    value.result.comparison = null

    expect(build(value).retrieval.summary).toBe('')
  })

  it('says no difference holds up when none does', () => {
    const same = Array.from({ length: 10 }, () => 1)

    expect(build(report({ vector: same, hybrid: same })).retrieval.summary).toBe(
      'No difference holds up on these 10 questions.',
    )
  })

  it('computes MRR from the ranks, with an interval', () => {
    const [, mrr] = build(report({ vector: [1, 1, 1, 1, 2, 2, 2, 2, null, null] })).retrieval.rows

    expect(mrr?.figures[0]).toMatchObject({ kind: 'mean', of: 10 })
    if (mrr?.figures[0]?.kind !== 'mean') throw new Error('not a mean')
    expect(mrr.figures[0].value).toBeCloseTo(0.6)
    expect(mrr.figures[0].low).toBeLessThan(0.6)
    expect(mrr.figures[0].high).toBeGreaterThan(0.6)
  })

  it('has no answers section for a run with none, and no judge', () => {
    const run = build(report())

    expect(run.answers).toBeNull()
    expect(run.trust.judge).toBeNull()
  })

  describe('with answers', () => {
    const answered = (overrides: Partial<EvalAnswers> = {}) =>
      answersFixture({
        answers: [1, 2, 3, 4, 5, 6, 7, 8].flatMap((i) => [
          answer(i, 0),
          answer(i, 2),
          answer(i, 3),
        ]),
        verdicts: [1, 2, 3, 4, 5, 6, 7, 8].flatMap((i) => [
          verdict(i, 0, i <= 6 ? 2 : 1),
          verdict(i, 2, 2),
          verdict(i, 3, i <= 2 ? 2 : 0),
        ]),
        support: [1, 2, 3, 4, 5, 6, 7, 8].flatMap((i) => [
          support(i, 2, true, true),
          support(i, 3, true, i === 1 ? false : true),
        ]),
        ...overrides,
      })

    const rowOf = (section: ReturnType<typeof build>['answers'], id: string) => {
      const row = section?.rows.find((candidate) => candidate.id === id)
      if (row === undefined) throw new Error(`no row ${id}`)
      return row
    }

    it('asks the answers question over all three rows', () => {
      const section = build(report({ answers: answered() })).answers

      expect(section?.question).toBe('Does it give better answers, and does RAG help at all?')
      expect(section?.columns).toEqual(['No RAG', 'Vector', 'Hybrid'])
    })

    it('counts fully correct as a score of 2, and compares that same thing', () => {
      const row = rowOf(build(report({ answers: answered() })).answers, 'fully-correct')

      expect(row.label).toBe('Fully correct')
      expect(row.figures.map((figure) => (figure.kind === 'share' ? figure.count : null))).toEqual([
        6, 8, 2,
      ])
      expect(row.comparisons[0]).toMatchObject({
        a: 'Vector',
        b: 'Hybrid',
        aAhead: 6,
        bAhead: 0,
        tied: 2,
      })
      expect(row.comparisons.map(({ a, b }) => [a, b])).toEqual([
        ['Vector', 'Hybrid'],
        ['No RAG', 'Vector'],
        ['No RAG', 'Hybrid'],
      ])
    })

    it('treats 1 and 0 as equally not fully correct, which the score tab tells apart', () => {
      const value = answered({
        answers: [answer(1, 2), answer(1, 3)],
        verdicts: [verdict(1, 2, 1), verdict(1, 3, 0)],
        support: [],
      })

      expect(
        rowOf(build(report({ answers: value })).answers, 'fully-correct').comparisons[0],
      ).toMatchObject({ aAhead: 0, bAhead: 0, tied: 1 })
    })

    it('counts all citations holding per answer, not per claim', () => {
      const row = rowOf(build(report({ answers: answered() })).answers, 'citations-hold')

      expect(row.figures[0]).toEqual({ kind: 'none', reason: 'cannot: no docs' })
      expect(row.figures[1]).toMatchObject({ count: 8, of: 8 })
      expect(row.figures[2]).toMatchObject({ count: 7, of: 8 })
      expect(row.comparisons[0]).toMatchObject({ aAhead: 1, bAhead: 0, tied: 7 })
    })

    it('marks correct and grounded as exploratory, and row 0 as unable by design', () => {
      const row = rowOf(build(report({ answers: answered() })).answers, 'correct-and-grounded')

      expect(row.exploratory).toBe(true)
      expect(row.figures[0]).toEqual({ kind: 'none', reason: 'cannot, by design' })
      expect(row.figures[2]).toMatchObject({ count: 7, of: 10 })
    })

    it('says so for a report from before the metric existed', () => {
      const value = answered()
      value.rows = value.rows.map((result) => ({
        ...result,
        overall: { ...result.overall, correctAndGrounded: undefined },
      }))

      expect(
        rowOf(build(report({ answers: value })).answers, 'correct-and-grounded').figures[1],
      ).toEqual({ kind: 'none', reason: 'not computed' })
    })

    it('reads stored comparisons for what needs the anchors', () => {
      const value = answered({
        comparisons: [
          {
            a: 'row 2',
            b: 'row 3',
            scopes: [
              {
                scope: 'overall',
                questions: 8,
                differences: [
                  {
                    metric: 'citation-accuracy',
                    a: 0.9,
                    b: 0.8,
                    aBetter: 3,
                    bBetter: 1,
                    tied: 4,
                    p: 0.6,
                    verdict: 'noise',
                  },
                ],
              },
            ],
          },
          {
            a: 'row 3',
            b: 'row 3 again',
            scopes: [
              {
                scope: 'overall',
                questions: 8,
                differences: [
                  {
                    metric: 'citation-accuracy',
                    a: 0.9,
                    b: 0.8,
                    aBetter: 2,
                    bBetter: 1,
                    tied: 5,
                    p: 1,
                    verdict: 'noise',
                  },
                ],
              },
            ],
          },
        ],
      })
      const row = rowOf(build(report({ answers: value })).answers, 'cites-anchor')

      expect(row.comparisons[0]).toMatchObject({ a: 'Vector', b: 'Hybrid', aAhead: 3, bAhead: 1 })
      expect(row.runToRun).toBe(3)
    })

    it('counts questions that differ between two runs of hybrid, and none without a second', () => {
      const once = build(report({ answers: answered() })).answers
      expect(once?.showRunToRun).toBe(false)
      expect(rowOf(once, 'fully-correct').runToRun).toBeNull()

      const value = answered()
      value.rows = [...value.rows, rowResult(3, 2)]
      value.verdicts = [
        ...value.verdicts,
        ...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => verdict(i, 3, i <= 3 ? 2 : 0, { sample: 2 })),
      ]
      value.support = [
        ...value.support,
        ...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({ ...support(i, 3, true), sample: 2 })),
      ]
      const twice = build(report({ answers: value })).answers

      expect(twice?.showRunToRun).toBe(true)
      expect(rowOf(twice, 'fully-correct').runToRun).toBe(1)
      expect(rowOf(twice, 'citations-hold').runToRun).toBe(1)
    })

    it('counts a question only one run has as differing, rather than vouching for it', () => {
      const value = answered()
      value.rows = [...value.rows, rowResult(3, 2)]
      value.verdicts = [...value.verdicts, verdict(1, 3, 2, { sample: 2 })]

      expect(rowOf(build(report({ answers: value })).answers, 'fully-correct').runToRun).toBe(7)
    })

    it('counts an answer that lost its citations in the second run as differing', () => {
      const value = answered()
      value.rows = [...value.rows, rowResult(3, 2)]
      value.support = [
        ...value.support,
        ...[1, 2, 3, 4, 5, 6].map((i) => ({ ...support(i, 3, i === 1 ? false : true), sample: 2 })),
      ]

      expect(rowOf(build(report({ answers: value })).answers, 'citations-hold').runToRun).toBe(2)
    })

    it('leaves citations on a question the docs do not answer out of what holds', () => {
      const value = answered({
        support: [...answered().support, support(41, 2, true), support(41, 3, true)],
      })

      expect(
        rowOf(build(report({ answers: value })).answers, 'citations-hold').figures[1],
      ).toMatchObject({ count: 8, of: 8 })
    })

    it('counts false refusals on answerable questions, and right refusals apart', () => {
      const value = answered({
        verdicts: [
          verdict(1, 2, 0, { falseRefusal: true }),
          verdict(2, 2, 2),
          verdict(41, 2, null, { outcome: 'correct-refusal' }),
          verdict(42, 2, null, { outcome: 'hallucination' }),
        ],
      })
      const section = build(report({ answers: value })).answers

      expect(rowOf(section, 'false-refusals').figures[1]).toMatchObject({ count: 1, of: 2 })
      expect(rowOf(section, 'right-refusals').figures[1]).toMatchObject({ count: 1, of: 2 })
    })

    it('counts the side that refuses less as ahead, since fewer refusals are better', () => {
      const value = answered({
        verdicts: [1, 2, 3, 4, 5, 6, 7, 8].flatMap((i) => [
          verdict(i, 2, 2),
          verdict(i, 3, 0, { falseRefusal: true }),
        ]),
      })
      const row = rowOf(build(report({ answers: value })).answers, 'false-refusals')

      expect(row.figures[1]).toMatchObject({ count: 0, of: 8 })
      expect(row.figures[2]).toMatchObject({ count: 8, of: 8 })
      expect(row.comparisons[0]).toMatchObject({
        a: 'Vector',
        b: 'Hybrid',
        aAhead: 8,
        bAhead: 0,
        verdict: 'a',
      })
    })

    it('leaves a failed verdict and a second opinion out of the counts', () => {
      const value = answered({
        verdicts: [
          verdict(1, 2, 2),
          verdict(2, 2, null, { status: 'failed' }),
          verdict(1, 2, 0, { judgeSample: 2 }),
        ],
      })

      expect(
        rowOf(build(report({ answers: value })).answers, 'fully-correct').figures[1],
      ).toMatchObject({ count: 1, of: 1 })
    })

    it('never rests the summary on an exploratory metric', () => {
      const value = answered({
        comparisons: [
          {
            a: 'row 2',
            b: 'row 3',
            scopes: [
              {
                scope: 'overall',
                questions: 8,
                differences: [
                  {
                    metric: 'correct-and-grounded',
                    a: 1,
                    b: 0,
                    aBetter: 8,
                    bBetter: 0,
                    tied: 0,
                    p: 0.008,
                    verdict: 'a',
                  },
                ],
              },
            ],
          },
        ],
        verdicts: [1, 2, 3, 4, 5, 6, 7, 8].flatMap((i) => [
          verdict(i, 0, 2),
          verdict(i, 2, 2),
          verdict(i, 3, 2),
        ]),
      })
      const section = build(report({ answers: value })).answers

      expect(rowOf(section, 'correct-and-grounded').comparisons[0]?.verdict).toBe('a')
      expect(section?.summary).toBe(
        'The judge is not calibrated for these prompts, so these are provisional. No difference between vector and hybrid holds up. Without docs, Claude is about as correct on this set, so correctness alone does not show what RAG adds. What RAG adds is grounding: most of its answers cite passages that hold.',
      )
    })

    it('says too few on so few answers, rather than about as correct', () => {
      const value = answered({
        verdicts: [1, 2, 3].flatMap((i) => [verdict(i, 0, 2), verdict(i, 2, 2), verdict(i, 3, 2)]),
        support: [],
      })

      expect(build(report({ answers: value })).answers?.summary).toBe(
        'The judge is not calibrated for these prompts, so these are provisional. Too few questions to say. Too few questions to say whether RAG helps.',
      )
    })

    const evenly = [1, 2, 3, 4, 5, 6, 7, 8].flatMap((i) => [
      verdict(i, 0, 2),
      verdict(i, 2, 2),
      verdict(i, 3, 2),
    ])
    const held = [1, 2, 3, 4, 5, 6, 7, 8].flatMap((i) => [support(i, 2, true), support(i, 3, true)])

    it('claims grounding only when the citations hold on most answers', () => {
      const shown = build(report({ answers: answered({ verdicts: evenly, support: held }) }))
      expect(shown.answers?.summary).toContain(
        'What RAG adds is grounding: most of its answers cite passages that hold.',
      )

      const broken = [1, 2, 3, 4, 5, 6, 7, 8].flatMap((i) => [
        support(i, 2, false),
        support(i, 3, false),
      ])
      for (const value of [[], broken]) {
        const summary = build(report({ answers: answered({ verdicts: evenly, support: value }) }))
          .answers?.summary
        expect(summary).toContain('about as correct')
        expect(summary).not.toContain('grounding')
      }
    })

    it('says about as correct only on noise, and never for a gap that is merely not significant', () => {
      const gap = (i: number) => (i <= 5 ? 0 : 2)
      const value = answered({
        verdicts: Array.from({ length: 8 }, (_, i) => i + 1).flatMap((i) => [
          verdict(i, 0, gap(i)),
          verdict(i, 2, 2),
          verdict(i, 3, 2),
        ]),
        support: held,
      })
      const section = build(report({ answers: value })).answers

      expect(rowOf(section, 'fully-correct').comparisons[1]?.verdict).toBe('not-significant')
      expect(section?.summary).toContain(
        'No difference between no RAG and RAG holds up on fully correct.',
      )
      expect(section?.summary).not.toContain('about as correct')
      expect(section?.summary).not.toContain('grounding')
    })

    it('names what a verdict names on any row, not only on correctness', () => {
      const value = answered({
        verdicts: evenly,
        support: [1, 2, 3, 4, 5, 6, 7, 8].flatMap((i) => [
          support(i, 2, true),
          support(i, 3, false),
        ]),
      })
      const { summary } = build(report({ answers: value })).answers ?? {}

      expect(summary).toContain('Vector better on citations that hold.')
      expect(summary).not.toContain('No difference between vector and hybrid')
    })

    it('says which RAG row no RAG beat, and never that it beat RAG as a whole', () => {
      const value = answered({
        verdicts: Array.from({ length: 8 }, (_, i) => i + 1).flatMap((i) => [
          verdict(i, 0, 2),
          verdict(i, 2, 2),
          verdict(i, 3, 0),
        ]),
      })
      const { summary } = build(report({ answers: value })).answers ?? {}

      expect(summary).toContain('On fully correct, No RAG better than Hybrid.')
      expect(summary).not.toContain('Vector better than')
    })

    it('calls a verdict noise when hybrid moves against itself by as much', () => {
      const value = answered({
        verdicts: Array.from({ length: 8 }, (_, i) => i + 1).flatMap((i) => [
          verdict(i, 0, 2),
          verdict(i, 2, 2),
          verdict(i, 3, 0),
          verdict(i, 3, i <= 4 ? 2 : 0, { sample: 2 }),
        ]),
      })
      value.rows = [...value.rows, rowResult(3, 2)]
      const section = build(report({ answers: value })).answers
      const row = rowOf(section, 'fully-correct')

      expect(row.runToRun).toBe(4)
      expect(row.comparisons[0]).toMatchObject({ aAhead: 8, bAhead: 0, verdict: 'noise' })
      expect(section?.summary).toContain('No difference between vector and hybrid holds up.')
    })

    it('never says about as correct for a gap that noise took the verdict from', () => {
      const value = answered({
        verdicts: Array.from({ length: 8 }, (_, i) => i + 1).flatMap((i) => [
          verdict(i, 0, 0),
          verdict(i, 2, 2),
          verdict(i, 3, 2),
          verdict(i, 3, i <= 4 ? 2 : 0, { sample: 2 }),
        ]),
      })
      value.rows = [...value.rows, rowResult(3, 2)]
      const section = build(report({ answers: value })).answers

      expect(rowOf(section, 'fully-correct').comparisons[1]).toMatchObject({
        a: 'No RAG',
        aAhead: 0,
        bAhead: 8,
        verdict: 'noise',
      })
      expect(section?.summary).not.toContain('about as correct')
      expect(section?.summary).toContain(
        'No difference between no RAG and RAG holds up on fully correct.',
      )
    })

    it('says so at the top when the judge is not calibrated, and beside the numbers', () => {
      const section = build(report({ answers: answered() })).answers

      expect(section?.summary).toMatch(/^The judge is not calibrated for these prompts/)
      expect(rowOf(section, 'fully-correct').note).toBe('not calibrated')
      expect(rowOf(section, 'correct-and-grounded').note).toBe('not calibrated')
    })

    it('shows no time and cost for a row with no finished answers', () => {
      const figures = rowOf(
        build(report({ answers: answered({ answers: [] }) })).answers,
        'time-and-cost',
      ).figures

      expect(figures[0]).toEqual({ kind: 'none', reason: 'none to count' })
    })

    it('names a row in the summary when a difference holds up', () => {
      const value = answered({
        verdicts: Array.from({ length: 8 }, (_, i) => i + 1).flatMap((i) => [
          verdict(i, 0, 0),
          verdict(i, 2, 2),
          verdict(i, 3, 0),
        ]),
      })

      expect(build(report({ answers: value })).answers?.summary).toBe(
        'The judge is not calibrated for these prompts, so these are provisional. Vector better on fully correct. On fully correct, Vector better than No RAG.',
      )
    })

    it('gives time and cost with their intervals in words', () => {
      const figure = rowOf(build(report({ answers: answered() })).answers, 'time-and-cost')
        .figures[0]

      expect(figure).toEqual({ kind: 'text', text: '2.0 s (2.0-2.0), $0.010 ($0.010-0.010)' })
    })

    it('puts the note on correctness when the labels lean', () => {
      const calibrations: EvalCalibration[] = [
        {
          report: { repoSha: 'x', name: null, createdAt: 'a' },
          blind: true,
          prompts: { correctness: 'c1', refusal: 'r1', support: 's1' },
          judgeModel: 'j',
          correctnessDisagreements: [{ questionId: ID(1), row: 3, human: 1, judge: 2 }],
          labelled: 1,
          agreement: [],
          unanswerableOnly: { compared: 0, agreed: 0 },
          calibrated: false,
        },
      ]
      const section = build(report({ answers: answered() }), calibrations).answers

      expect(rowOf(section, 'fully-correct').note).toBe('not calibrated, may run high')
      expect(rowOf(section, 'correct-and-grounded').note).toBe('not calibrated, may run high')

      const result = (dimension: 'correctness' | 'refusal' | 'support') => ({
        dimension,
        compared: 1,
        agreed: 1,
        kappa: 1,
        interval: [0.5, 1] as [number, number],
        passed: true,
      })
      const passed = calibrations.map((round) => ({
        ...round,
        agreement: [result('correctness'), result('refusal'), result('support')],
      }))
      const calibrated = build(report({ answers: answered() }), passed).answers

      expect(rowOf(calibrated, 'fully-correct').note).toBe('may run high')
      expect(rowOf(calibrated, 'correct-and-grounded').note).toBe('may run high')
      expect(calibrated?.summary).not.toContain('not calibrated')
    })
  })

  describe('trust', () => {
    it('reports the set, the docs, the index and stale questions', () => {
      const value = report()
      value.result.stale = [ID(1)]
      value.result.review = [ID(2)]

      expect(
        buildDashboardRun({
          id: 'x',
          report: value,
          calibrations: [],
          verify: null,
          indexDocsSha: 'other',
        }).trust,
      ).toMatchObject({
        goldenSet: { version: 1, hash: 'set-hash' },
        docs: { sha: 'docs-sha' },
        indexDocsSha: 'other',
        stale: [ID(1)],
        review: [ID(2)],
        verify: null,
      })
    })

    it('puts a recorded verify in words, with when', () => {
      const verify: EvalVerifyRecord = {
        status: 'identical',
        changedVectors: [],
        rerun: { repoSha: 'abcdef1234', repoDirty: false, at: 'then' },
      }

      expect(
        buildDashboardRun({
          id: 'x',
          report: report(),
          calibrations: [],
          verify,
          indexDocsSha: null,
        }).trust.verify,
      ).toEqual({
        status: 'identical',
        text: 'Retrieval reproduced byte for byte at abcdef12, on the same vectors.',
        checkedAt: 'then',
      })
    })
  })
})

describe('buildDashboardDetails', () => {
  const questions = parseGoldenSet(
    [
      { id: ID(1), question: 'First?', answer: 'A.', primary: ['a.md'], tags: ['basic', 'edge'] },
      { id: ID(2), question: 'Second?', answer: 'A.', primary: ['a.md'], tags: ['basic'] },
      { id: ID(41), question: 'Not covered?', answer: 'No.', tags: ['unanswerable'] },
    ]
      .map((row) => JSON.stringify(row))
      .join('\n'),
  )

  it('makes a table per metric, with a row per tag and its size', () => {
    const { tags } = buildDashboardDetails({ report: report(), questions, calibrations: [] })

    expect(tags.map(({ question }) => question)).toEqual([
      'Right chunk in top 8, by tag',
      'How high it ranks (MRR), by tag',
    ])
    expect(tags[0]?.rows.map(({ label, note }) => [label, note])).toEqual([
      ['basic', '10 questions'],
      ['edge', '2 questions'],
    ])
    expect(tags[0]?.rows[1]?.comparisons[0]?.verdict).toBe('too-few')
  })

  it('adds fully correct and the score, with its own comparison, when there are answers', () => {
    const answers = answersFixture({
      verdicts: [verdict(1, 2, 1), verdict(1, 3, 0), verdict(1, 0, 2)],
    })
    const { tags } = buildDashboardDetails({
      report: report({ answers }),
      questions,
      calibrations: [],
    })
    const score_ = tags.find(({ question }) => question === 'Correctness score, 0 to 2')

    expect(tags.map(({ question }) => question)).toContain('Fully correct, by tag')
    expect(score_?.rows[0]?.label).toBe('All questions')
    expect(score_?.rows[0]?.comparisons[0]).toMatchObject({ a: 'Vector', aAhead: 1, bAhead: 0 })
  })

  it('gives the same verdict by tag as the first screen, on the same data', () => {
    const eight = Array.from({ length: 8 }, (_, i) => i + 1)
    const answers = answersFixture({
      rows: [rowResult(0), rowResult(2), rowResult(3), rowResult(3, 2)],
      verdicts: eight.flatMap((i) => [
        verdict(i, 2, 2),
        verdict(i, 3, 0),
        verdict(i, 3, i <= 4 ? 2 : 0, { sample: 2 }),
      ]),
    })
    const { tags } = buildDashboardDetails({
      report: report({ answers }),
      questions,
      calibrations: [],
    })
    const row = (question: string) =>
      tags
        .find((section) => section.question === question)
        ?.rows.find(({ label }) => label === 'basic')

    for (const question of ['Fully correct, by tag', 'Correctness score, 0 to 2']) {
      expect(tags.find((section) => section.question === question)?.showRunToRun).toBe(true)
      expect(row(question)?.runToRun).toBe(4)
      expect(row(question)?.comparisons[0]).toMatchObject({ aAhead: 8, verdict: 'noise' })
    }
  })

  it('puts the score on a scale of 0 to 2, and says so', () => {
    const answers = answersFixture({ verdicts: [verdict(1, 2, 2), verdict(1, 3, 2)] })
    const { tags } = buildDashboardDetails({
      report: report({ answers }),
      questions,
      calibrations: [],
    })
    const score_ = tags.find(({ question }) => question === 'Correctness score, 0 to 2')

    expect(score_?.scale).toBe('0 to 2')
    expect(score_?.rows[0]?.figures[1]).toMatchObject({ kind: 'mean', value: 2, max: 2 })
    expect(tags.find(({ question }) => question.startsWith('Fully'))?.scale).toBe('0 to 100%')
  })

  it('says what stands beside the grades, wherever they are', () => {
    const answers = answersFixture({ verdicts: [verdict(1, 2, 2)] })

    expect(
      buildDashboardDetails({ report: report({ answers }), questions, calibrations: [] }).gradeNote,
    ).toBe('not calibrated')
    expect(buildDashboardDetails({ report: report(), questions, calibrations: [] }).gradeNote).toBe(
      null,
    )
  })

  it('lists each question, in words, and says where rows or strategies differ', () => {
    const answers = answersFixture({
      verdicts: [
        verdict(1, 0, 2),
        verdict(1, 2, 1),
        verdict(1, 3, 0, { falseRefusal: true }),
        verdict(41, 0, null, { outcome: 'correct-refusal' }),
        verdict(41, 2, null, { outcome: 'correct-refusal' }),
        verdict(41, 3, null, { outcome: 'correct-refusal' }),
      ],
    })
    const details = buildDashboardDetails({
      report: report({ answers, vector: [1, 3], hybrid: [2, 3] }),
      questions,
      calibrations: [],
    })
    const [first, second, third] = details.questions

    expect(first).toMatchObject({ id: ID(1), question: 'First?', differs: true })
    expect(first?.ranks).toEqual([
      { column: 'Vector', rank: 1 },
      { column: 'Hybrid', rank: 2 },
    ])
    expect(first?.answers).toEqual([
      { column: 'No RAG', grade: 'Fully correct' },
      { column: 'Vector', grade: 'Partly correct' },
      { column: 'Hybrid', grade: 'Refused' },
    ])
    expect(second?.ranks.map(({ rank }) => rank)).toEqual([3, 3])
    expect(second?.answers.map(({ grade }) => grade)).toEqual(['-', '-', '-'])
    expect(second?.differs).toBe(false)
    expect(third?.answers.map(({ grade }) => grade)).toEqual([
      'Refused rightly',
      'Refused rightly',
      'Refused rightly',
    ])
    expect(third?.differs).toBe(false)
  })

  it('says a question differs when only the ranks do, or only the answers', () => {
    const answers = answersFixture({
      verdicts: [verdict(1, 2, 2), verdict(1, 3, 2), verdict(2, 2, 2), verdict(2, 3, 1)],
    })
    const details = buildDashboardDetails({
      report: report({ answers, vector: [1, 3], hybrid: [2, 3] }),
      questions,
      calibrations: [],
    })

    expect(details.questions[0]?.answers.map(({ grade }) => grade)).toEqual([
      '-',
      'Fully correct',
      'Fully correct',
    ])
    expect(details.questions.map(({ differs }) => differs).slice(0, 2)).toEqual([true, true])

    const sameAnswers = buildDashboardDetails({
      report: report({
        answers: answersFixture({
          rows: [rowResult(2), rowResult(3)],
          verdicts: [verdict(1, 2, 2), verdict(1, 3, 2), verdict(2, 2, 2), verdict(2, 3, 1)],
        }),
        vector: [1, 3],
        hybrid: [2, 3],
      }),
      questions,
      calibrations: [],
    })

    // Only the ranks differ on the first, and only the answers on the second.
    expect(sameAnswers.questions[0]?.differs).toBe(true)
    expect(sameAnswers.questions[1]?.ranks.map(({ rank }) => rank)).toEqual([3, 3])
    expect(sameAnswers.questions[1]?.differs).toBe(true)
  })

  it('lists the cited chunks under the row that cited them', () => {
    const answers = answersFixture({
      candidates: [{ questionId: ID(1), row: 2, chunkId: 'c1', docPath: 'a.md' }],
    })

    expect(
      buildDashboardDetails({ report: report({ answers }), questions, calibrations: [] })
        .candidates,
    ).toEqual([{ questionId: ID(1), column: 'Vector', chunkId: 'c1', docPath: 'a.md' }])
  })
})

describe('compareDashboardRuns', () => {
  const named = (name: string, overrides: Parameters<typeof report>[0] = {}) => {
    const value = report(overrides)
    value.run.name = name
    return value
  }

  it('shows both runs, each number on its own side', () => {
    const result = compareDashboardRuns(
      named('before', { hybrid: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1] }),
      named('after', { hybrid: [9, 9, 9, 9, 9, 9, 9, 9, 1, 1] }),
    )

    if (!result.comparable) throw new Error('not comparable')
    expect(result).toMatchObject({ a: 'before', b: 'after' })
    const row = result.section.rows.find(({ id }) => id === 'hybrid-top-8')
    expect(row?.figures[0]).toMatchObject({ count: 10 })
    expect(row?.figures[1]).toMatchObject({ count: 2 })
    expect(row?.comparisons[0]).toMatchObject({ a: 'before', b: 'after', aAhead: 8, bAhead: 0 })
    expect(result.moved).toHaveLength(8)
    expect(result.moved[0]).toEqual({ strategy: 'Hybrid', questionId: ID(1), from: 1, to: 9 })
  })

  it('says what else differs, since a change of rank means little until that is known', () => {
    const later = named('after')
    later.identity.chunkerVersion = 6
    later.vectors.corpusHash = 'other'

    const result = compareDashboardRuns(named('before'), later)

    if (!result.comparable) throw new Error('not comparable')
    expect(result.differences).toEqual([
      'identity.chunkerVersion: before 5, after 6',
      'vectors.corpusHash: before c, after other',
    ])
    expect(result.section.summary).toBe('No right chunk moved.')
  })

  it('refuses two set versions, and one version with two contents', () => {
    const other = named('after')
    other.identity.goldenSet = { version: 2, hash: 'set-hash' }
    const tampered = named('after')
    tampered.identity.goldenSet = { version: 1, hash: 'other' }

    expect(compareDashboardRuns(named('before'), other)).toMatchObject({ comparable: false })
    expect(compareDashboardRuns(named('before'), tampered)).toMatchObject({ comparable: false })
  })

  it('tells two runs of one name apart', () => {
    const result = compareDashboardRuns(named('same'), named('same'))

    if (!result.comparable) throw new Error('not comparable')
    expect([result.a, result.b]).toEqual(['same (1)', 'same (2)'])
  })
})
