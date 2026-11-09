import { describe, expect, it } from 'vitest'

import { typescriptSource } from './index.ts'
import { displayCode, interviewTopicOf } from './interview.ts'

const DOCS = 'packages/documentation/copy/en'

describe('interviewTopicOf (ADR-0018)', () => {
  it('makes each Handbook and Reference page a topic of its group', () => {
    expect(
      interviewTopicOf({
        path: `${DOCS}/handbook-v2/Type Manipulation/Generics.md`,
        docType: 'handbook',
        title: 'Generics',
      }),
    ).toEqual({
      id: 'handbook-v2/Type Manipulation/Generics',
      title: 'Generics',
      group: 'Handbook',
    })
    expect(
      interviewTopicOf({
        path: `${DOCS}/modules-reference/Theory.md`,
        docType: 'reference',
        title: 'Modules - Theory',
      }),
    ).toEqual({ id: 'modules-reference/Theory', title: 'Modules - Theory', group: 'Reference' })
  })

  it('puts every compiler option in one topic', () => {
    const topic = (name: string) =>
      interviewTopicOf({
        path: `packages/tsconfig-reference/copy/en/options/${name}.md`,
        docType: 'option',
        title: `TSConfig Option: ${name}`,
      })

    expect(topic('strict')).toEqual({
      id: 'compiler-options',
      title: 'Compiler options',
      group: 'Compiler options',
    })
    expect(topic('noImplicitAny')).toEqual(topic('strict'))
  })

  it('leaves out the release notes and the other docs', () => {
    expect(
      interviewTopicOf({
        path: `${DOCS}/release-notes/TypeScript 5.0.md`,
        docType: 'release-notes',
        title: 'TypeScript 5.0',
      }),
    ).toBeUndefined()
    expect(
      interviewTopicOf({
        path: `${DOCS}/declaration-files/Publishing.md`,
        docType: 'other',
        title: 'Publishing',
      }),
    ).toBeUndefined()
  })

  it('is what the source and its compiled variant give', () => {
    const source = typescriptSource()
    const handbook = {
      path: `${DOCS}/handbook-v2/Narrowing.md`,
      docType: 'handbook' as const,
      title: 'Narrowing',
    }

    expect(source.interviewTopic?.(handbook)).toEqual(interviewTopicOf(handbook))
    expect(source.compiled?.().interviewTopic?.(handbook)).toEqual(interviewTopicOf(handbook))
    const shown = { code: 'let a = 1', setup: '' }
    expect(source.displayCode?.('// @noErrors\nlet a = 1')).toEqual(shown)
    expect(source.compiled?.().displayCode?.('// @noErrors\nlet a = 1')).toEqual(shown)
  })
})

describe('displayCode (ADR-0018)', () => {
  it('takes out the directives and type queries that would give the answer away', () => {
    const code = [
      '// @errors: 2345',
      '// @strict: false',
      '// @noErrors',
      'function padLeft(padding: number | string, input: string) {',
      '  return " ".repeat(padding) + input;',
      '}',
      'let n = 1;',
      '//  ^?',
      '// @ts-expect-error',
      'n = "x";',
    ].join('\n')

    expect(displayCode(code)).toEqual({
      code: [
        'function padLeft(padding: number | string, input: string) {',
        '  return " ".repeat(padding) + input;',
        '}',
        'let n = 1;',
        '// @ts-expect-error',
        'n = "x";',
      ].join('\n'),
      setup: '',
    })
  })

  it('keeps file names, which the example shows', () => {
    expect(displayCode('// @filename: a.ts\nexport const a = 1').code).toBe(
      '// @filename: a.ts\nexport const a = 1',
    )
  })

  it('shows only what the cut markers leave visible, and keeps the rest as the setup', () => {
    const code = [
      '// @errors: 2304',
      'declare const hidden: string',
      '//            ^?',
      '// ---cut---',
      '',
      'const shown = hidden',
      '// ---cut-start---',
      'const alsoHidden = 1',
      '// ---cut-end---',
      'shown.length',
      '// ---cut-after---',
      'const after = 2',
    ].join('\n')

    expect(displayCode(code)).toEqual({
      code: 'const shown = hidden\nshown.length',
      setup: 'declare const hidden: string\nconst alsoHidden = 1\nconst after = 2',
    })
  })
})
