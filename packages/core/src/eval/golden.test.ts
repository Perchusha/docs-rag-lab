import { describe, expect, it } from 'vitest'

import { anchorKey, GoldenSetError, parseGoldenSet } from './golden.ts'

const valid = {
  id: 'ts-0001',
  question: 'What is a union?',
  answer: 'One of several types.',
  primary: ['docs/a.md#unions'],
  tags: ['basic'],
}

const parse = (...rows: unknown[]) =>
  parseGoldenSet(rows.map((row) => JSON.stringify(row)).join('\n'))

function problemsOf(...rows: unknown[]): readonly string[] {
  try {
    parse(...rows)
  } catch (error) {
    if (error instanceof GoldenSetError) return error.problems
    throw error
  }
  throw new Error('expected a GoldenSetError')
}

describe('parseGoldenSet', () => {
  it('fills in the defaults, so a question reads the same however it was written', () => {
    expect(parse(valid)).toEqual([
      {
        ...valid,
        primary: [{ at: 'docs/a.md#unions' }],
        primaryMatch: 'all',
        acceptable: [],
        note: undefined,
      },
    ])
  })

  it('reads pinned anchors, acceptable anchors, primaryMatch and a note', () => {
    const [question] = parse({
      ...valid,
      primary: ['docs/a.md#one', { at: 'docs/a.md#two', contains: 'exact words' }],
      primaryMatch: 'any',
      acceptable: ['docs/b.md'],
      note: 'Revisit after M7.',
    })

    expect(question).toMatchObject({
      primary: [{ at: 'docs/a.md#one' }, { at: 'docs/a.md#two', contains: 'exact words' }],
      primaryMatch: 'any',
      acceptable: [{ at: 'docs/b.md' }],
      note: 'Revisit after M7.',
    })
  })

  it('takes an unanswerable question with no anchors', () => {
    const [question] = parse({ ...valid, primary: undefined, tags: ['unanswerable'] })

    expect(question).toMatchObject({ primary: [], acceptable: [], tags: ['unanswerable'] })
  })

  it('ignores blank lines, and a Windows line ending', () => {
    const text = `${JSON.stringify(valid)}\r\n\n`

    expect(parseGoldenSet(text)).toHaveLength(1)
  })

  it.each([
    ['a misspelled field', { ...valid, acceptible: ['docs/b.md'] }, 'unknown field "acceptible"'],
    ['an unknown tag', { ...valid, tags: ['basics'] }, 'unknown tag "basics"'],
    ['no tags', { ...valid, tags: [] }, '"tags" must be a non-empty array'],
    ['a repeated tag', { ...valid, tags: ['basic', 'basic'] }, 'a tag is listed twice'],
    ['a malformed id', { ...valid, id: 'q1' }, '"id" must look like ts-0001, got "q1"'],
    [
      'a primary that is not a list',
      { ...valid, primary: 'docs/a.md' },
      '"primary" must be an array',
    ],
    ['an empty question', { ...valid, question: ' ' }, '"question" must be a non-empty string'],
    ['an empty answer', { ...valid, answer: '' }, '"answer" must be a non-empty string'],
    ['an empty note', { ...valid, note: '' }, '"note" must be a non-empty string'],
    [
      'no primary anchor',
      { ...valid, primary: [] },
      'a question needs at least one primary anchor, or the tag "unanswerable"',
    ],
    [
      'an unanswerable question with anchors',
      { ...valid, tags: ['unanswerable'] },
      'an unanswerable question has no anchors',
    ],
    [
      'an anchor in both lists',
      { ...valid, acceptable: ['docs/a.md#unions'] },
      'an anchor is listed twice',
    ],
    [
      'an anchor with an empty fragment',
      { ...valid, primary: ['docs/a.md#'] },
      'an anchor needs a path, optionally with #section, got "docs/a.md#"',
    ],
    [
      'an anchor with two fragments',
      { ...valid, primary: ['docs/a.md#b#c'] },
      'an anchor needs a path, optionally with #section, got "docs/a.md#b#c"',
    ],
    [
      'an anchor without a path',
      { ...valid, primary: ['#section'] },
      'an anchor needs a path, optionally with #section, got "#section"',
    ],
    [
      'an empty pin',
      { ...valid, primary: [{ at: 'docs/a.md', contains: '' }] },
      '"contains" must be a non-empty string in the anchor docs/a.md',
    ],
    [
      'a misspelled anchor field',
      { ...valid, primary: [{ at: 'docs/a.md', contain: 'x' }] },
      'unknown anchor field "contain"',
    ],
    [
      'primaryMatch all, which is the default',
      { ...valid, primaryMatch: 'all' },
      '"primaryMatch" can only be "any"; leave it out for "all", got "all"',
    ],
    [
      'primaryMatch any with one anchor',
      { ...valid, primaryMatch: 'any' },
      '"primaryMatch": "any" needs at least two primary anchors',
    ],
  ])('refuses %s', (_name, row, problem) => {
    expect(problemsOf(row)).toEqual([`line 1: ${problem}`])
  })

  it('refuses a repeated id, and names the line', () => {
    expect(problemsOf(valid, valid)).toEqual(['line 2: the id ts-0001 is used twice'])
  })

  it('reports every problem at once, not only the first', () => {
    const problems = problemsOf({ ...valid, tags: ['nope'] }, 'not an object', {
      ...valid,
      id: 'ts-0002',
      extra: 1,
    })

    expect(problems).toEqual([
      'line 1: unknown tag "nope"',
      'line 2: a question must be a JSON object',
      'line 3: unknown field "extra"',
    ])
  })

  it('refuses a line that is not JSON, and a file with no questions', () => {
    expect(() => parseGoldenSet('{not json')).toThrow('line 1: not valid JSON')
    expect(() => parseGoldenSet('\n')).toThrow('the file has no questions')
  })

  it('keeps two pins on one section apart', () => {
    const one = { at: 'docs/a.md#s', contains: 'one' }
    const two = { at: 'docs/a.md#s', contains: 'two' }

    expect(anchorKey(one)).not.toBe(anchorKey(two))
    expect(anchorKey({ at: 'docs/a.md#s' })).toBe('docs/a.md#s')
    expect(parse({ ...valid, primary: [one, two] })[0]?.primary).toEqual([one, two])
  })
})
