import type { AnswerRow, EvalAnswer, EvalSupport, EvalVerdict } from '@docs-rag-lab/contracts'
import { describe, expect, it } from 'vitest'

import {
  anchorCandidates,
  compareRows,
  judgeRetest,
  rowResult,
  type AnswerResultsOptions,
} from './answer-metrics.ts'
import { parseGoldenSet } from './golden.ts'

const ID = (i: number): string => `ts-${String(i).padStart(4, '0')}`

const questions = parseGoldenSet(
  [
    ...Array.from({ length: 10 }, (_, i) => ({
      id: ID(i + 1),
      question: `Q${String(i + 1)}?`,
      answer: 'A.',
      primary: ['a.md'],
      tags: [i < 6 ? 'basic' : 'edge'],
    })),
    { id: ID(11), question: 'Not covered?', answer: 'No.', tags: ['unanswerable'] },
  ]
    .map((row) => JSON.stringify(row))
    .join('\n'),
)

const answer = (i: number, row: AnswerRow, overrides: Partial<EvalAnswer> = {}): EvalAnswer => ({
  questionId: ID(i),
  row,
  sample: 1,
  status: 'ok',
  model: 'm',
  stopReason: 'end_turn',
  text: 'T',
  blocks: [],
  claims: [{ text: 'C', citations: [{ chunkId: 'anchor', citedText: 'P' }] }],
  context: [],
  inputTokens: 100,
  outputTokens: 10,
  costUsd: 0.01,
  latencyMs: 1000,
  firstTokenMs: 100,
  fromCache: false,
  ...overrides,
})

const verdict = (
  i: number,
  row: AnswerRow,
  correctness: 0 | 1 | 2 | null,
  overrides: Partial<EvalVerdict> = {},
): EvalVerdict => ({
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
})

const support = (i: number, row: AnswerRow, ...supported: boolean[]): EvalSupport => ({
  questionId: ID(i),
  row,
  sample: 1,
  status: 'ok',
  claims: supported.map((value) => ({ supported: value, reason: 'r' })),
  costUsd: 0,
})

function options(overrides: Partial<AnswerResultsOptions>): AnswerResultsOptions {
  return {
    questions,
    answers: [],
    verdicts: [],
    support: [],
    anchorChunks: () => new Set(['anchor']),
    ...overrides,
  }
}

describe('rowResult', () => {
  it('counts scores, false refusals, citations and support for its own row', () => {
    const result = rowResult(
      3,
      1,
      options({
        answers: [
          answer(1, 3),
          answer(2, 3, {
            claims: [{ text: 'C', citations: [{ chunkId: 'other', citedText: 'P' }] }],
          }),
          answer(3, 3, { claims: [] }),
          answer(1, 2, { costUsd: 99 }),
        ],
        verdicts: [
          verdict(1, 3, 2),
          verdict(2, 3, 1),
          verdict(3, 3, 0, { falseRefusal: true }),
          verdict(1, 2, 0),
        ],
        support: [support(1, 3, true, false), support(2, 3, true), support(1, 2, false)],
      }),
    )

    expect(result.overall).toMatchObject({
      questions: 3,
      correctness: 1,
      scores: [1, 1, 1],
      falseRefusals: 1,
      citationAccuracy: { cited: 2, hit: 1 },
      support: { claims: 3, supported: 2 },
      meanCostUsd: 0.01,
      meanLatencyMs: 1000,
    })
  })

  it('reports a question the docs do not answer apart, and never as a score', () => {
    const result = rowResult(
      0,
      1,
      options({
        answers: [answer(1, 0, { claims: [] }), answer(11, 0, { claims: [] })],
        verdicts: [verdict(1, 0, 2), verdict(11, 0, null, { outcome: 'hallucination' })],
      }),
    )

    expect(result.overall.questions).toBe(1)
    expect(result.overall.correctness).toBe(2)
    expect(result.refusals).toEqual({ questions: 1, correct: 0, hallucinations: 1, wrong: 0 })
    expect(Object.keys(result.byTag)).toEqual(['basic'])
  })

  it('keeps truncated, refused and failed answers out of the metrics, by name', () => {
    const result = rowResult(
      3,
      1,
      options({
        answers: [
          answer(1, 3),
          answer(2, 3, { status: 'truncated', costUsd: 50 }),
          answer(3, 3, { status: 'refused', costUsd: 50 }),
          answer(4, 3, { status: 'failed', costUsd: 50 }),
        ],
        verdicts: [verdict(1, 3, 2)],
        support: [support(1, 3, true)],
      }),
    )

    expect(result.overall.questions).toBe(1)
    expect(result.overall.meanCostUsd).toBe(0.01)
    expect(result.excluded).toEqual({
      truncated: [ID(2)],
      refused: [ID(3)],
      failed: [ID(4)],
      unjudged: [],
    })
  })

  it('reads the first opinion and the first sample only', () => {
    const result = rowResult(
      3,
      1,
      options({
        answers: [answer(1, 3), answer(1, 3, { sample: 2 })],
        verdicts: [
          verdict(1, 3, 2),
          verdict(1, 3, 0, { judgeSample: 2 }),
          verdict(1, 3, 1, { sample: 2 }),
        ],
      }),
    )

    expect(result.overall).toMatchObject({ questions: 1, correctness: 2 })
  })

  it('splits by tag', () => {
    const result = rowResult(
      3,
      1,
      options({
        answers: [answer(1, 3), answer(7, 3)],
        verdicts: [verdict(1, 3, 2), verdict(7, 3, 0)],
      }),
    )

    expect(result.byTag.basic?.correctness).toBe(2)
    expect(result.byTag.edge?.correctness).toBe(0)
  })

  it('leaves a failed verdict out of the mean instead of counting it as 0', () => {
    const result = rowResult(
      3,
      1,
      options({
        answers: [answer(1, 3), answer(2, 3)],
        verdicts: [verdict(1, 3, 2), verdict(2, 3, null, { status: 'failed' })],
        support: [support(1, 3, true), support(2, 3, true)],
      }),
    )

    expect(result.overall).toMatchObject({ questions: 1, correctness: 2 })
    expect(result.excluded.unjudged).toEqual([ID(2)])
  })

  it('lists an answer whose citations the judge could not read as not judged', () => {
    const result = rowResult(
      3,
      1,
      options({
        answers: [answer(1, 3), answer(2, 3, { claims: [] })],
        verdicts: [verdict(1, 3, 2), verdict(2, 3, 2)],
        support: [{ ...support(1, 3), status: 'failed' }],
      }),
    )

    expect(result.excluded.unjudged).toEqual([ID(1)])
  })

  it('needs no citation check for a question the docs do not answer', () => {
    const result = rowResult(
      3,
      1,
      options({
        answers: [answer(11, 3)],
        verdicts: [verdict(11, 3, null, { outcome: 'wrong' })],
      }),
    )

    expect(result.excluded.unjudged).toEqual([])
  })
})

describe('compareRows', () => {
  const a = { row: 2, sample: 1 } as const
  const b = { row: 3, sample: 1 } as const
  const correctnessOf = (result: ReturnType<typeof compareRows>, scope = 'overall') =>
    result.scopes
      .find((item) => item.scope === scope)
      ?.differences.find((item) => item.metric === 'correctness')

  it('names the side that won, with each number on its own side', () => {
    const ids = [1, 2, 3, 4, 5, 6, 7, 8]
    const result = compareRows(
      a,
      b,
      options({
        answers: ids.flatMap((i) => [answer(i, 2), answer(i, 3)]),
        verdicts: ids.flatMap((i) => [verdict(i, 2, 2), verdict(i, 3, 0)]),
      }),
    )

    expect(result).toMatchObject({ a: 'row 2', b: 'row 3' })
    expect(correctnessOf(result)).toMatchObject({
      a: 2,
      b: 0,
      aBetter: 8,
      bBetter: 0,
      tied: 0,
      verdict: 'a',
    })
  })

  it('calls a win by one or two questions noise', () => {
    const result = compareRows(
      a,
      b,
      options({
        answers: [1, 2, 3].flatMap((i) => [answer(i, 2), answer(i, 3)]),
        verdicts: [
          verdict(1, 2, 2),
          verdict(1, 3, 1),
          verdict(2, 2, 2),
          verdict(2, 3, 2),
          verdict(3, 2, 2),
          verdict(3, 3, 2),
          verdict(4, 2, 2),
        ],
      }),
    )

    expect(correctnessOf(result)).toMatchObject({ aBetter: 1, tied: 2, verdict: 'too-few' })
  })

  it('compares only questions both rows scored, and no unanswerable one', () => {
    const result = compareRows(
      a,
      b,
      options({
        answers: [
          answer(1, 2),
          answer(1, 3),
          answer(2, 2),
          answer(3, 3),
          answer(4, 2),
          answer(4, 3, { status: 'failed' }),
          answer(11, 2),
          answer(11, 3),
        ],
        verdicts: [
          verdict(1, 2, 2),
          verdict(1, 3, 2),
          verdict(2, 2, 2),
          verdict(3, 3, 2),
          verdict(4, 2, 2),
          verdict(11, 2, null, { outcome: 'wrong' }),
          verdict(11, 3, null, { outcome: 'wrong' }),
        ],
      }),
    )

    expect(result.scopes[0]).toMatchObject({ scope: 'overall', questions: 1 })
  })

  it('compares citation accuracy and support only where both cite something', () => {
    const result = compareRows(
      a,
      b,
      options({
        answers: [
          answer(1, 2),
          answer(1, 3, {
            claims: [{ text: 'C', citations: [{ chunkId: 'other', citedText: 'P' }] }],
          }),
          answer(2, 2, { claims: [] }),
          answer(2, 3),
        ],
        verdicts: [verdict(1, 2, 2), verdict(1, 3, 2), verdict(2, 2, 2), verdict(2, 3, 2)],
        support: [support(1, 2, true, true), support(1, 3, true, false), support(2, 3, true)],
      }),
    )
    const overall = result.scopes[0]?.differences

    expect(overall?.find((item) => item.metric === 'citation-accuracy')).toMatchObject({
      a: 1,
      b: 0,
      aBetter: 1,
      bBetter: 0,
      tied: 0,
    })
    expect(overall?.find((item) => item.metric === 'support')).toMatchObject({
      a: 1,
      b: 0.5,
      aBetter: 1,
      tied: 0,
    })
  })

  it('leaves a metric out when no question has it, as with row 0 and citations', () => {
    const result = compareRows(
      { row: 0, sample: 1 },
      b,
      options({
        answers: [answer(1, 0, { claims: [] }), answer(1, 3)],
        verdicts: [verdict(1, 0, 1), verdict(1, 3, 2)],
      }),
    )

    expect(result.scopes[0]?.differences.map((item) => item.metric)).toEqual([
      'correctness',
      'fully-correct',
      'not-wrongly-refused',
    ])
  })

  it('compares what ADR-0014 decides on: fully correct, citations that hold, wrong refusals', () => {
    const result = compareRows(
      { row: 3, sample: 1 },
      { row: 4, sample: 1 },
      options({
        answers: [1, 2, 3].flatMap((i) => [answer(i, 3), answer(i, 4)]),
        verdicts: [
          verdict(1, 3, 1),
          verdict(1, 4, 2),
          verdict(2, 3, 0, { falseRefusal: true }),
          verdict(2, 4, 2),
          verdict(3, 3, 2),
          verdict(3, 4, 2),
        ],
        support: [
          support(1, 3, true, false),
          support(1, 4, true, true),
          support(2, 3, true),
          support(2, 4, true),
          support(3, 3, true),
          support(3, 4, true),
        ],
      }),
    )
    const of = (metric: string) =>
      result.scopes[0]?.differences.find((item) => item.metric === metric)

    expect(of('fully-correct')).toMatchObject({ aBetter: 0, bBetter: 2, tied: 1 })
    expect(of('citations-hold')).toMatchObject({
      a: 0.666667,
      b: 1,
      aBetter: 0,
      bBetter: 1,
      tied: 2,
    })
    expect(of('not-wrongly-refused')).toMatchObject({ aBetter: 0, bBetter: 1, tied: 2 })
  })

  it('reports per tag too, and labels a second sample', () => {
    const result = compareRows(
      b,
      { row: 3, sample: 2 },
      options({
        answers: [answer(1, 3), answer(1, 3, { sample: 2 })],
        verdicts: [verdict(1, 3, 2), verdict(1, 3, 1, { sample: 2 })],
      }),
    )

    expect(result.b).toBe('row 3 again')
    expect(result.scopes.map(({ scope }) => scope)).toEqual(['overall', 'basic'])
    expect(correctnessOf(result, 'basic')).toMatchObject({ a: 2, b: 1 })
  })
})

describe('correct and grounded, exploratory', () => {
  const grounded = (result: ReturnType<typeof rowResult>) => result.overall.correctAndGrounded

  const one = (overrides: Partial<EvalAnswer>, score: 0 | 1 | 2, ...supported: boolean[]) =>
    grounded(
      rowResult(
        3,
        1,
        options({
          answers: [answer(1, 3, overrides)],
          verdicts: [verdict(1, 3, score)],
          support: supported.length === 0 ? [] : [support(1, 3, ...supported)],
        }),
      ),
    )
  const other = {
    claims: [{ text: 'C', citations: [{ chunkId: 'other', citedText: 'P' }] }],
  }

  it('counts an answer that is right, fully supported and cites an anchor', () => {
    expect(one({}, 2, true, true)).toBe(1)
  })

  it('needs an acceptable or primary anchor among several citations, not all of them', () => {
    expect(
      one(
        {
          claims: [
            { text: 'C', citations: [{ chunkId: 'other', citedText: 'P' }] },
            { text: 'D', citations: [{ chunkId: 'anchor', citedText: 'P' }] },
          ],
        },
        2,
        true,
        true,
      ),
    ).toBe(1)
  })

  it.each([
    ['it scored 1', {}, 1, [true]],
    ['a cited claim is not supported', {}, 2, [true, false]],
    ['it cites no anchor', other, 2, [true]],
    ['it cites nothing', { claims: [] }, 2, []],
    ['the support check failed', {}, 2, []],
  ] as const)('does not count it when %s', (_name, overrides, score, supported) => {
    expect(one(overrides as Partial<EvalAnswer>, score, ...supported)).toBe(0)
  })

  it('compares rows 2 and 3, counting an uncited answer as 0', () => {
    const result = compareRows(
      { row: 2, sample: 1 },
      { row: 3, sample: 1 },
      options({
        answers: [answer(1, 2), answer(1, 3, { claims: [] })],
        verdicts: [verdict(1, 2, 2), verdict(1, 3, 2)],
        support: [support(1, 2, true)],
      }),
    )

    expect(
      result.scopes[0]?.differences.find(({ metric }) => metric === 'correct-and-grounded'),
    ).toMatchObject({ a: 1, b: 0, aBetter: 1, bBetter: 0, tied: 0 })
  })

  it('leaves row 0 out of the comparison, which cannot score on it by design', () => {
    const result = compareRows(
      { row: 0, sample: 1 },
      { row: 3, sample: 1 },
      options({
        answers: [answer(1, 0, { claims: [] }), answer(1, 3)],
        verdicts: [verdict(1, 0, 2), verdict(1, 3, 2)],
        support: [support(1, 3, true)],
      }),
    )

    expect(result.scopes[0]?.differences.map(({ metric }) => metric)).toEqual([
      'correctness',
      'fully-correct',
      'not-wrongly-refused',
    ])
  })
})

describe('judgeRetest', () => {
  it('is null without a second opinion', () => {
    expect(judgeRetest([verdict(1, 3, 2)])).toBeNull()
  })

  it('counts the second opinions that match the first, on score and on outcome', () => {
    expect(
      judgeRetest([
        verdict(1, 3, 2),
        verdict(1, 3, 2, { judgeSample: 2 }),
        verdict(2, 3, 2),
        verdict(2, 3, 1, { judgeSample: 2 }),
        verdict(11, 3, null, { outcome: 'wrong' }),
        verdict(11, 3, null, { outcome: 'hallucination', judgeSample: 2 }),
        verdict(3, 3, null, { judgeSample: 2, status: 'failed' }),
      ]),
    ).toEqual({ compared: 3, agreed: 1 })
  })
})

describe('anchorCandidates', () => {
  const docPath = (id: string): string => `${id}.md`
  const other = { text: 'C', citations: [{ chunkId: 'other', citedText: 'P' }] }

  it('lists a chunk that supports a correct answer and is no anchor, and adds nothing', () => {
    expect(
      anchorCandidates(
        options({
          answers: [answer(1, 3, { claims: [other] })],
          verdicts: [verdict(1, 3, 2)],
          support: [support(1, 3, true)],
        }),
        docPath,
      ),
    ).toEqual([{ questionId: ID(1), row: 3, chunkId: 'other', docPath: 'other.md' }])
  })

  it.each([
    ['the answer is only partly right', 1, true],
    ['the claim is not supported', 2, false],
  ] as const)('skips it when %s', (_name, score, supported) => {
    expect(
      anchorCandidates(
        options({
          answers: [answer(1, 3, { claims: [other] })],
          verdicts: [verdict(1, 3, score)],
          support: [support(1, 3, supported)],
        }),
        docPath,
      ),
    ).toEqual([])
  })

  it('skips a chunk that is an anchor already', () => {
    expect(
      anchorCandidates(
        options({
          answers: [answer(1, 3)],
          verdicts: [verdict(1, 3, 2)],
          support: [support(1, 3, true)],
        }),
        docPath,
      ),
    ).toEqual([])
  })

  it('lists a chunk once per question, under the lowest row', () => {
    const found = anchorCandidates(
      options({
        answers: [answer(1, 3, { claims: [other] }), answer(1, 2, { claims: [other] })],
        verdicts: [verdict(1, 3, 2), verdict(1, 2, 2)],
        support: [support(1, 3, true), support(1, 2, true)],
      }),
      docPath,
    )

    expect(found.map(({ row }) => row)).toEqual([2])
  })
})

describe('row 6 metrics', () => {
  const step = (write: number, read: number, stopReason = 'end_turn') => ({
    stopReason,
    inputTokens: 5,
    cacheWriteTokens: write,
    cacheReadTokens: read,
    outputTokens: 10,
  })

  it('counts searches, steps, cache writes and reads, lapses, and what the searches reached', () => {
    const result = rowResult(
      6,
      1,
      options({
        primaryChunks: (id) => new Set(id === ID(1) ? ['p1'] : ['p2']),
        answers: [
          // Answers from its first search, which held the anchor.
          answer(1, 6, {
            context: ['p1', 'x'],
            steps: [step(1000, 0)],
            searches: [],
            costUsd: 0.01,
            uncachedCostUsd: 0.008,
          }),
          // Its own search brings the anchor, and its second step reads nothing: a lapse.
          answer(2, 6, {
            context: ['x', 'p2'],
            steps: [step(1000, 0, 'tool_use'), step(900, 0)],
            searches: [{ query: 'q', docTypes: [], chunkIds: ['p2'], alreadyShown: 0 }],
            costUsd: 0.02,
            uncachedCostUsd: 0.025,
          }),
          // A question the docs do not answer, whose first step read another answer's entry.
          answer(11, 6, { context: ['x'], steps: [step(0, 1000)], searches: [], costUsd: 0.001 }),
        ],
      }),
    )

    expect(result.agent).toEqual({
      answers: 3,
      searchedAgain: 1,
      searches: 1,
      steps: 4,
      inputTokens: 20,
      cacheWriteTokens: 2900,
      cacheReadTokens: 1000,
      outputTokens: 40,
      costUsd: 0.031,
      uncachedCostUsd: 0.033,
      lapses: 1,
      firstStepReads: 1,
      primaryInFirstSearch: 1,
      primaryReached: 2,
      answerable: 2,
    })
  })

  it('leaves the other rows as they were', () => {
    expect(rowResult(3, 1, options({ answers: [answer(1, 3)] }))).not.toHaveProperty('agent')
  })
})
