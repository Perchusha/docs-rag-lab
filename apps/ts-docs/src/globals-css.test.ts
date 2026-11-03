import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/** The value a stylesheet's body rule gives a property. */
function bodyDeclaration(path: string, property: string): string | undefined {
  const rule = /(?:^|\n)body\s*\{([^}]*)\}/.exec(readFileSync(path, 'utf8'))?.[1] ?? ''
  return new RegExp(`(?:^|[\\s;])${property}:\\s*([^;]+);`).exec(rule)?.[1]
}

describe('the page colours', () => {
  const app = join(import.meta.dirname, '../app/globals.css')
  const storybook = join(import.meta.dirname, '../../../packages/ui/.storybook/preview.css')

  it.each([
    ['background', 'var(--color-bg)'],
    ['color', 'var(--color-text)'],
  ])(
    'give the body the same %s in the app and in Storybook, so a page cannot pass in one and fail in the other',
    (property, value) => {
      expect(bodyDeclaration(app, property)).toBe(value)
      expect(bodyDeclaration(storybook, property)).toBe(value)
    },
  )
})
