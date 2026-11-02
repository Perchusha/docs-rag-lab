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

  it('leaves other lines alone', () => {
    expect(scan('* * *\n- item\n> quote\n1. one').inCode).toEqual([false, false, false, false])
  })

  it('takes a quoted line for code when the block itself is not quoted', () => {
    expect(scan('```\n> ```\nb').open?.line).toBe(0)
  })
})
