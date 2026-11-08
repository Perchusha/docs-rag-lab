import { describe, expect, it } from 'vitest'

import { renderBlock } from './chunker.ts'
import { codeBlocks, compiledExamples } from './examples.ts'
import type { Block, CompilerOutput } from './types.ts'

const withError: CompilerOutput = {
  errors: [{ code: 2345, line: 'f("x");', text: "Argument of type 'string' is not assignable." }],
  queries: [],
}
const withQuery: CompilerOutput = {
  errors: [],
  queries: [{ target: 'n', line: 'let n = 1;', text: 'let n: number' }],
}
const emittedOnly: CompilerOutput = {
  errors: [],
  queries: [],
  emitted: { name: 'index.js', lang: 'js', code: 'var n = 1;' },
}
const silent: CompilerOutput = { errors: [], queries: [] }

const blocks: Block[] = [
  { kind: 'prose', text: 'Some prose.' },
  { kind: 'code', lang: 'ts', code: 'const plain = 1' },
  {
    kind: 'code',
    lang: 'ts',
    code: 'declare function f(n: number): void\nf("x");',
    compiled: withError,
  },
  { kind: 'code', lang: 'ts', code: 'let quiet = 2', compiled: silent },
  { kind: 'code', lang: 'ts', code: 'let n = 1;', compiled: emittedOnly },
  {
    kind: 'callout',
    variant: 'Note',
    blocks: [{ kind: 'code', lang: 'ts', code: 'let n = 1;\n//  ^?', compiled: withQuery }],
  },
]
const text = ['Doc > Section', ...blocks.map(renderBlock)].join('\n\n')
const compiler = [withError, silent, emittedOnly, withQuery]

describe('codeBlocks', () => {
  it('reads every fenced block, with its info string and offsets', () => {
    const found = codeBlocks('Intro\n\n```js src/App.js\nexport default 1\n```\n\nEnd')

    expect(found).toEqual([{ info: 'js src/App.js', code: 'export default 1', start: 7, end: 44 }])
  })

  it('keeps a shorter fence inside a longer one as code', () => {
    const found = codeBlocks('````md\n```ts\nx\n```\n````')

    expect(found.map(({ code }) => code)).toEqual(['```ts\nx\n```'])
  })
})

describe('compiledExamples (ADR-0018)', () => {
  it('pairs each output that has errors or queries with the block it follows', () => {
    expect(compiledExamples(text, compiler)).toEqual([
      { lang: 'ts', code: 'declare function f(n: number): void\nf("x");', output: withError },
      { lang: 'ts', code: 'let n = 1;\n//  ^?', output: withQuery },
    ])
  })

  it('pairs nothing when the text and the metadata disagree', () => {
    expect(compiledExamples(text, [withError])).toEqual([])
  })
})
