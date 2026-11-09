// `drl questions` end to end, over a seeded compiled index in the OS temp dir, with a fake Claude:
// nothing reaches the network (ADR-0018).
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  CHUNKER_VERSION,
  COMPILER_IDENTITY_PREFIX,
  createEmbeddingProvider,
  GENERATE_SYSTEM_PROMPT,
  interviewStatePath,
  openIndexes,
  openInterviewState,
  readBank,
  type EvalClient,
  type QuestionRow,
  type Source,
} from '@docs-rag-lab/core'
import { settings } from '@docs-rag-lab/settings'
import { renderBlock, type CompilerOutput } from '@docs-rag-lab/source-kit'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { checkPath, sheetPath } from './questions.ts'
import { run } from './run.ts'

vi.setConfig({ testTimeout: 30_000 })

let root: string
let claudeRequests: Parameters<EvalClient['messages']['stream']>[0][] = []

const output: CompilerOutput = {
  errors: [
    {
      code: 2322,
      line: 'let n: number = "x"',
      text: "Type 'string' is not assignable to type 'number'.",
    },
  ],
  queries: [],
}

const base: Omit<Source, 'compiled'> = {
  id: 'typescript',
  repo: 'r',
  branch: 'v2',
  include: [],
  license: { name: 'l', url: 'u', attribution: 'a' },
  parserVersion: 1,
  match: () => true,
  parse: () => Promise.reject(new Error('not parsed in this test')),
  interviewTopic: ({ path, title }) => ({ id: path, title, group: 'Handbook' }),
  displayCode: (code) => ({ code: code.replace('// @errors: 2322\n', ''), setup: '' }),
}
const source: Source = { ...base, compiled: () => ({ ...base, compiler: 'twoslash test' }) }

const PROSE = (id: string) =>
  `The value of ${id} is checked against its annotation, and a mismatch is an error at compile time. ${'Words. '.repeat(40)}`

function seedCompiledIndex(): void {
  const { dimensions } = settings.embeddings
  const chunk = (id: string, i: number, blocks: string[], compiler?: CompilerOutput[]) => {
    let text = `A > ${id}`
    const spans: [number, number][] = []
    for (const block of blocks) {
      text += '\n\n'
      spans.push([text.length, text.length + block.length])
      text += block
    }
    return {
      id,
      ordinal: i,
      headingPath: [id],
      anchor: id,
      blockTypes: ['prose'],
      text,
      context: null,
      metadata: { sectionPath: [id], spans, ...(compiler === undefined ? {} : { compiler }) },
      tokenCount: 50,
      textHash: `hash-${id}`,
      vector: Float32Array.from({ length: dimensions }, (_, j) => (j === i ? 1 : 0)),
    }
  }
  const indexes = openIndexes(join(root, settings.dataDir), 'typescript', { variant: 'compiled' })
  indexes.index.applyChanges({
    documents: [
      {
        path: 'docs/a.md',
        url: 'https://x.dev/a',
        title: 'Types',
        docType: 'handbook',
        contentHash: 'h',
        lastChangedSha: 's',
        chunks: [
          chunk(
            'one',
            0,
            [
              PROSE('one'),
              renderBlock({
                kind: 'code',
                lang: 'ts',
                code: '// @errors: 2322\nlet n: number = "x"',
                compiled: output,
              }),
            ],
            [output],
          ),
          chunk('two', 1, [PROSE('two')]),
        ],
      },
    ],
    deletePaths: [],
    manifest: {
      sourceId: 'typescript',
      repo: 'r',
      branch: 'v2',
      includePaths: [],
      commitSha: 'docs-sha',
      syncedAt: '2026-11-08T00:00:00.000Z',
      embedModel: createEmbeddingProvider(settings.embeddings).id,
      embedDimensions: dimensions,
      contextModel: `${COMPILER_IDENTITY_PREFIX}twoslash test`,
      chunkerVersion: CHUNKER_VERSION,
      parserVersion: 2,
    },
  })
  indexes.close()
}

/** Writes one theory question per chunk, quoting its first sentence, and keeps every question. */
const fakeClient: EvalClient = {
  messages: {
    stream(request) {
      claudeRequests.push(request)
      const content = request.messages[0]?.content
      const texts = Array.isArray(content)
        ? content.map((part) => (part.type === 'text' ? part.text : ''))
        : []
      const body =
        request.system === GENERATE_SYSTEM_PROMPT
          ? (() => {
              const id = /The value of (\w+)/.exec(texts[1] ?? '')?.[1] ?? 'x'
              return {
                questions: [
                  {
                    kind: 'theory',
                    question: `When is a wrong value of ${id} reported?`,
                    answer: 'At compile time, when it does not match its annotation.',
                    quote: `The value of ${id} is checked against its annotation`,
                    code_block: 0,
                  },
                ],
              }
            })()
          : {
              verdicts: [
                { question: 1, reason: 'The chunk says so.', answerable: true, correct: true },
              ],
            }
      const message = {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: JSON.stringify(body), citations: null }],
        usage: { input_tokens: 1000, output_tokens: 100 },
      } as unknown as Awaited<
        ReturnType<ReturnType<EvalClient['messages']['stream']>['finalMessage']>
      >
      return {
        on: () => undefined,
        finalMessage: () => Promise.resolve(message),
        currentMessage: message,
      }
    },
    countTokens: () => Promise.resolve({ input_tokens: 1000 }),
  },
}

async function drl(...argv: string[]) {
  let out = ''
  let err = ''
  const code = await run(argv, {
    settings,
    sources: [source],
    out: { write: (text: string) => (out += text) },
    err: { write: (text: string) => (err += text) },
    root,
    debug: false,
    createEvalClient: () => fakeClient,
  })
  return { code, out, err }
}

const bankFile = () => join(root, 'interview', 'bank', 'typescript.jsonl')
const questionsIn = (): QuestionRow[] =>
  (readBank(bankFile())?.rows ?? []).filter((row): row is QuestionRow => row.row === 'question')

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'drl-questions-'))
  writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages: []\n')
  vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test')
  vi.stubEnv('VOYAGE_API_KEY', 'pa-test')
  claudeRequests = []
  seedCompiledIndex()
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(root, { recursive: true, force: true })
})

describe('drl questions (ADR-0018)', () => {
  it('writes the compiler questions, which cost nothing, and prints the estimate of the rest', async () => {
    const { code, out } = await drl('questions', 'typescript')

    expect(code).toBe(0)
    expect(claudeRequests).toEqual([])
    expect(out).toContain('1 compiler questions and 0 generated questions kept')
    expect(out).toContain('this would write and check questions for 2 chunks over 1 documents')
    expect(out).toContain('add --yes to run it, after a pilot (--pilot 10 --yes)')
    const [compiler] = questionsIn()
    expect(compiler?.question).toMatchObject({
      kind: 'compiler-error',
      code: { code: 'let n: number = "x"', compiled: true },
      compiler: { compiler: 'twoslash test' },
      verifiedBy: 'compiler',
    })
    expect(readBank(bankFile())?.header).toMatchObject({
      source: 'typescript',
      variant: 'compiled',
      docsCommit: 'docs-sha',
    })
  })

  it('pilots on a few chunks, shows their questions and forecasts the rest', async () => {
    const { code, out } = await drl('questions', 'typescript', '--pilot', '1', '--yes')

    expect(code).toBe(0)
    expect(claudeRequests.map((request) => request.model)).toEqual([
      settings.models.questions,
      settings.models.questionCheck,
    ])
    expect(out).toContain('1 questions written: 1 shown')
    expect(out).toContain('**Question:** When is a wrong value of one reported?')
    expect(out).toContain('the forecast for all 2 chunks')
    expect(questionsIn().map((row) => [row.question.kind, row.status])).toEqual([
      ['compiler-error', 'shown'],
      ['theory', 'shown'],
    ])
  })

  it('reads no chunk again that an earlier run read', async () => {
    await drl('questions', 'typescript', '--pilot', '1', '--yes')
    claudeRequests = []

    const { out } = await drl('questions', 'typescript', '--yes')
    expect(
      claudeRequests.filter((request) => request.model === settings.models.questions),
    ).toHaveLength(1)
    expect(questionsIn().filter((row) => row.question.kind === 'theory')).toHaveLength(2)
    expect((await drl('questions', 'typescript')).out).toContain(
      'every chunk in scope has been read',
    )
    expect(out).toContain('1 questions written')
  })

  it('writes the sheet of the sample, and scores labels only against that sample', async () => {
    await drl('questions', 'typescript', '--yes')

    const sampled = await drl('questions', 'sample')
    expect(sampled.code).toBe(0)
    const sheet = readFileSync(sheetPath(root), 'utf8')
    const hash = /Sample `([0-9a-f]{12})`/.exec(sheet)?.[1] ?? ''
    expect(sheet).toContain('**The cited passage:**')
    expect(sheet).not.toContain('The chunk says so.')

    const labels = join(root, 'labels.json')
    writeFileSync(
      labels,
      JSON.stringify({
        sample: hash,
        labels: [1, 2].map((item) => ({ item, answerable: true, correct: item === 1 })),
      }),
    )
    const scored = await drl('questions', 'score', labels)
    expect(scored.code).toBe(0)
    expect(scored.out).toContain('Passed both counts: 1 of 2')
    expect(scored.out).toContain('H holds.')
    expect(existsSync(checkPath(root))).toBe(true)

    writeFileSync(labels, JSON.stringify({ sample: 'aaaaaaaaaaaa', labels: [] }))
    const wrong = await drl('questions', 'score', labels)
    expect(wrong.code).toBe(1)
    expect(wrong.err).toContain('these labels are of sample aaaaaaaaaaaa')
  })

  it('rejects a shown question by the owner, and a rerun keeps the rejection', async () => {
    await drl('questions', 'typescript', '--yes')
    const [compiler, theory] = questionsIn()
    if (compiler === undefined || theory === undefined) throw new Error('no questions')

    const rejected = await drl(
      'questions',
      'reject',
      theory.question.id,
      'Says more than its quote.',
    )
    expect(rejected.code).toBe(0)
    expect(rejected.out).toContain(`rejected ${theory.question.id} of typescript`)
    expect(await drl('questions', 'reject', compiler.question.id, 'Wrong line.')).toMatchObject({
      code: 0,
    })
    const statuses = () =>
      questionsIn().map((row) => [row.question.kind, row.status, row.ownerReason])
    const expected = [
      ['compiler-error', 'rejected-owner', 'Wrong line.'],
      ['theory', 'rejected-owner', 'Says more than its quote.'],
      ['theory', 'shown', undefined],
    ]
    expect(statuses()).toEqual(expected)

    // Compiler questions are made again on every run, and keep their rejection.
    claudeRequests = []
    await drl('questions', 'typescript', '--yes')
    expect(claudeRequests).toEqual([])
    expect(statuses()).toEqual(expected)
  })

  it('refuses a rejection with no reason, or of a question no bank has', async () => {
    await drl('questions', 'typescript')
    const [compiler] = questionsIn()

    const noReason = await drl('questions', 'reject', compiler?.question.id ?? '')
    expect(noReason.code).toBe(1)
    expect(noReason.err).toContain(
      `questions reject needs a reason, or a flag of ${compiler?.question.id ?? ''} in the app to take it from`,
    )
    const unknown = await drl('questions', 'reject', 'nope', 'Wrong.')
    expect(unknown.code).toBe(1)
    expect(unknown.err).toContain('no bank has a question nope')
  })

  it('lists the cards flagged in the app, and rejects one with the reason of its flag', async () => {
    expect((await drl('questions', 'flagged')).out).toContain('no card is flagged as wrong')
    await drl('questions', 'typescript', '--yes')
    const [compiler, theory] = questionsIn()
    if (compiler === undefined || theory === undefined) throw new Error('no questions')
    const state = openInterviewState(interviewStatePath(root, settings.dataDir))
    state.saveFlag({
      questionId: theory.question.id,
      reason: 'The code shows otherwise.',
      flaggedAt: '2026-11-09T10:00:00.000Z',
    })
    state.saveFlag({ questionId: 'gone', reason: 'Old.', flaggedAt: '2026-11-09T11:00:00.000Z' })
    state.close()

    const listed = await drl('questions', 'flagged')
    expect(listed.code).toBe(0)
    expect(listed.out).toContain('2 cards flagged as wrong')
    expect(listed.out).toContain(`${theory.question.id}, flagged 2026-11-09, typescript theory`)
    expect(listed.out).toContain('Your reason: The code shows otherwise.')
    expect(listed.out).toContain(`pnpm drl questions reject ${theory.question.id}`)
    expect(listed.out).toContain('In the bank: no longer there')

    expect((await drl('questions', 'reject', theory.question.id)).code).toBe(0)
    expect(questionsIn().find((row) => row.question.id === theory.question.id)).toMatchObject({
      status: 'rejected-owner',
      ownerReason: 'The code shows otherwise.',
    })
    expect((await drl('questions', 'flagged')).out).toContain('In the bank: rejected already')
  })

  it('refuses --pilot with commands other than sync --contextual and questions', async () => {
    const { code, err } = await drl('eval', '--pilot', '3')

    expect(code).toBe(2)
    expect(err).toContain('--pilot works only with sync --contextual and questions')
  })
})
