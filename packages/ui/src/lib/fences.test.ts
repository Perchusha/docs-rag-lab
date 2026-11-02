import { describe, expect, it } from 'vitest'

import { scanFences } from './fences.ts'

const scan = (text: string) => scanFences(text.split('\n'))

describe('scanFences', () => {
  it('marks a block, its fences included', () => {
    expect(scan('a\n```ts\nb\n```\nc')).toEqual({
      inCode: [false, true, true, true, false],
      open: undefined,
    })
  })

  it('keeps a block open across a line that only looks like its closer', () => {
    // An info string: this opens nothing and closes nothing inside a block.
    expect(scan('```\n```ts\nb').open?.line).toBe(0)
    // Too short.
    expect(scan('````\n```\nb').open?.line).toBe(0)
    // The other character.
    expect(scan('~~~\n```\nb').open?.line).toBe(0)
    expect(scan('```\n~~~\nb').open?.line).toBe(0)
  })

  it('closes with a longer fence, and with spaces after it', () => {
    expect(scan('```\nb\n`````').open).toBeUndefined()
    expect(scan('```\nb\n```  ').open).toBeUndefined()
  })

  it('takes a closed 3-tick block inside a 4-tick one for code', () => {
    const { inCode, open } = scan('````\n```ts\nb\n```\n````\nc')
    expect(inCode).toEqual([true, true, true, true, true, false])
    expect(open).toBeUndefined()
  })

  it('does not take inline code at the start of a line for a fence', () => {
    expect(scan('```x``` is inline').inCode).toEqual([false])
  })

  it('finds fences inside lists and quotes, and closes them the same way', () => {
    expect(scan('- item\n\n    ```ts\n    b').open).toEqual({ line: 2, closer: '    ```' })
    expect(scan('1. ```ts\n   b').open).toEqual({ line: 0, closer: '   ```' })
    expect(scan('- ```ts\n  b').open).toEqual({ line: 0, closer: '  ```' })
    expect(scan('> ```ts\n> b').open).toEqual({ line: 0, closer: '> ```' })
    expect(scan('> ```ts\n> b\n> ```').open).toBeUndefined()
    expect(scan('- item\n  ```\n  b\n  ```').open).toBeUndefined()
  })

  it('takes a closer indented 4 spaces or a tab deeper for code', () => {
    expect(scan('```\na\n    ```\nb').open?.line).toBe(0)
    expect(scan('```\na\n\t```\nb').open?.line).toBe(0)
    expect(scan('```\na\n   ```\nb').open).toBeUndefined()
    expect(scan('- a\n\n    ```\n    b\n       ```').open).toBeUndefined()
  })

  it('ends a block with the quote it opened in', () => {
    expect(scan('> ```ts\n> b\n\nAfter').inCode).toEqual([true, true, false, false])
    expect(scan('> ```ts\n> b\nAfter').open).toBeUndefined()
    expect(scan('> > ```\n> > b\n> After').open).toBeUndefined()
    // A closer outside the quote ends it, and opens a block of its own.
    expect(scan('> ```\n> b\n```\nAfter').open?.line).toBe(2)
  })

  it('ends a block with the list item it opened on', () => {
    expect(scan('- ```ts\n  b\n\nAfter').inCode).toEqual([true, true, true, false])
    expect(scan('1. ```ts\nb\nAfter').inCode).toEqual([true, false, false])
    // Blank lines do not end it.
    expect(scan('- ```ts\n  b\n\n  c').open?.line).toBe(0)
  })

  it('reads a tilde fence that ends with a carriage return', () => {
    expect(scan('~~~ts\r\ncode\r\n~~~\r\nAfter').inCode).toEqual([true, true, true, false])
  })

  it('leaves other lines alone', () => {
    expect(scan('* * *\n- item\n> quote\n1. one').inCode).toEqual([false, false, false, false])
  })

  it('takes a quoted line for code when the block itself is not quoted', () => {
    expect(scan('```\n> ```\nb').open?.line).toBe(0)
  })
})
