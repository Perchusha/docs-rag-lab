import { describe, expect, it } from 'vitest'

import { codeSpans } from './code-spans.ts'

describe('codeSpans (ADR-0018)', () => {
  it('splits plain text from code spans', () => {
    expect(codeSpans('What does `typeof x` give for `null`?')).toEqual([
      { code: false, text: 'What does ' },
      { code: true, text: 'typeof x' },
      { code: false, text: ' give for ' },
      { code: true, text: 'null' },
      { code: false, text: '?' },
    ])
  })

  it('reads a longer run around code that holds a backtick, without its padding', () => {
    const line = 'type Id = `${Lang}_${Name}`;'

    expect(codeSpans(`On the line \`\` ${line} \`\`?`)).toEqual([
      { code: false, text: 'On the line ' },
      { code: true, text: line },
      { code: false, text: '?' },
    ])
  })

  it('leaves a backtick with no partner as text', () => {
    expect(codeSpans('A lone ` stays.')).toEqual([{ code: false, text: 'A lone ` stays.' }])
    expect(codeSpans('')).toEqual([])
  })
})
