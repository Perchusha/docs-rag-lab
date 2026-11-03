import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const app = join(import.meta.dirname, '../app/globals.css')
const storybook = join(import.meta.dirname, '../../../packages/ui/.storybook/preview.css')

/** The value a stylesheet's body rule gives a property. */
function bodyDeclaration(path: string, property: string): string | undefined {
  const rule = /(?:^|\n)body\s*\{([^}]*)\}/.exec(readFileSync(path, 'utf8'))?.[1] ?? ''
  return new RegExp(`(?:^|[\\s;])${property}:\\s*([^;]+);`).exec(rule)?.[1]
}

const BODY = [
  ['background', 'var(--color-bg)', '--color-bg'],
  ['color', 'var(--color-text)', '--color-text'],
  ['font-family', 'var(--font-sans)', '--font-sans'],
  ['line-height', 'var(--leading)', '--leading'],
] as const

describe('the page', () => {
  it('imports the ui tokens itself, before any rule, since CSS ignores an import after one', () => {
    expect(readFileSync(app, 'utf8')).toMatch(
      /^(?:\s|\/\*[\s\S]*?\*\/)*@import '@docs-rag-lab\/ui\/tokens\.css';/,
    )
  })

  it('resolves that import to the file that defines what the body reads', () => {
    const tokens = readFileSync(
      createRequire(import.meta.url).resolve('@docs-rag-lab/ui/tokens.css'),
      'utf8',
    )

    for (const [, , token] of BODY) expect(tokens).toContain(`${token}:`)
  })

  it.each(BODY)(
    'gives the body the same %s in the app and in Storybook, so a page cannot pass in one and fail in the other',
    (property, value) => {
      expect(bodyDeclaration(app, property)).toBe(value)
      expect(bodyDeclaration(storybook, property)).toBe(value)
    },
  )
})
