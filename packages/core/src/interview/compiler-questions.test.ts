import { renderBlock, type CompilerOutput, type Source } from '@docs-rag-lab/source-kit'
import { describe, expect, it } from 'vitest'

import { compilerQuestions, ERROR_PROMPT, typePrompt } from './compiler-questions.ts'
import { testChunk, testDocument } from './test-chunks.ts'

const COMPILER = 'twoslash 0.3.9, typescript 6.0.2'

const source: Source = {
  id: 'typescript',
  repo: 'r',
  branch: 'b',
  include: [],
  license: { name: 'l', url: 'u', attribution: 'a' },
  parserVersion: 1,
  match: () => true,
  parse: () => Promise.reject(new Error('not parsed in this test')),
  // As the TypeScript source does it, in short: no directives and no query lines.
  displayCode: (code) =>
    code
      .split('\n')
      .filter((line) => !/^\s*\/\/\s*(@\w+|\^)/.test(line))
      .join('\n'),
}

const errors: CompilerOutput = {
  errors: [
    {
      code: 2345,
      line: 'f("x");',
      text: "Argument of type 'string' is not assignable\n  to 'number'.",
    },
  ],
  queries: [],
}
const queries: CompilerOutput = {
  errors: [],
  queries: [
    { target: 'n', line: 'let n = 1;', text: 'let n: number' },
    { target: 'hidden', line: 'let hidden = 2;', text: 'let hidden: number' },
  ],
}
const hiddenError: CompilerOutput = {
  errors: [{ code: 1005, line: 'declare const cut: string', text: "';' expected." }],
  queries: [],
}

const code = (text: string, compiled: CompilerOutput) =>
  renderBlock({ kind: 'code', lang: 'ts', code: text, compiled })

const chunk = testChunk(
  'chunk-1',
  [
    'Some prose about narrowing.',
    code('// @errors: 2345\ndeclare function f(n: number): void\nf("x");', errors),
    code('let n = 1;\n//  ^?', queries),
  ],
  { compiler: [errors, queries], anchor: 'narrowing' },
)
const document = testDocument('handbook/Narrowing.md', [chunk], 'handbook/Narrowing')

describe('compilerQuestions (ADR-0018)', () => {
  const made = compilerQuestions(source, document, COMPILER)

  it('asks which errors an example with errors gives, and answers with the compiler', () => {
    const error = made.find(({ question }) => question.kind === 'compiler-error')

    expect(error?.question).toMatchObject({
      source: 'typescript',
      topicId: 'handbook/Narrowing',
      prompt: ERROR_PROMPT,
      code: { lang: 'ts', code: 'declare function f(n: number): void\nf("x");', compiled: true },
      answer:
        "It does not compile. TypeScript reports:\n- TS2345 on `f(\"x\");`: Argument of type 'string' is not assignable   to 'number'.",
      compiler: { compiler: COMPILER, errors: errors.errors, queries: [] },
      citation: {
        url: 'https://docs.example.com/handbook/Narrowing#narrowing',
        title: 'Title of handbook/Narrowing.md',
        sectionPath: ['Section'],
        docPath: 'handbook/Narrowing.md',
        chunkId: 'chunk-1',
      },
      verifiedBy: 'compiler',
    })
    expect(error?.textHash).toBe(chunk.textHash)
  })

  it('asks for each type query whose line the docs show', () => {
    const types = made.filter(({ question }) => question.kind === 'compiler-type')

    expect(types.map(({ question }) => [question.prompt, question.answer])).toEqual([
      [typePrompt('n', 'let n = 1;'), 'let n: number'],
    ])
    expect(types[0]?.question.code?.code).toBe('let n = 1;')
    expect(types[0]?.question.compiler?.queries).toEqual([queries.queries[0]])
  })

  it('gives stable IDs that change with the chunk text', () => {
    const again = compilerQuestions(source, document, COMPILER)
    const edited = testChunk('chunk-1', ['Other prose.', ...chunk.text.split('\n\n').slice(2)], {
      compiler: chunk.compiler,
    })

    expect(again.map(({ question }) => question.id)).toEqual(
      made.map(({ question }) => question.id),
    )
    expect(new Set(made.map(({ question }) => question.id)).size).toBe(made.length)
    const changed = compilerQuestions(
      source,
      testDocument('handbook/Narrowing.md', [edited]),
      COMPILER,
    )
    expect(changed[0]?.question.id).not.toBe(made[0]?.question.id)
  })

  it('asks nothing of an error on a line the docs do not show', () => {
    const cut = testChunk(
      'chunk-2',
      [code('// @noErrors\n//  ^? declare const cut: string', hiddenError)],
      {
        compiler: [hiddenError],
      },
    )

    expect(compilerQuestions(source, testDocument('a.md', [cut]), COMPILER)).toEqual([])
  })
})
