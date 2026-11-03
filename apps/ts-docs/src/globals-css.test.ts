// Every app under apps/ loads the ui tokens itself, and gives the body what Storybook gives it, so
// a page cannot pass in one and fail in the other (ADR-0008). It sits in this app and looks at them
// all: ts-docs depends on ui, so a change to the tokens or to Storybook's page selects it. turbo.json
// lists the other apps' files as inputs of this test, so that a change to them is no cached pass.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const root = join(import.meta.dirname, '../../..')
const appsDir = join(root, 'apps')
const storybook = join(root, 'packages/ui/.storybook/preview.css')

/** Every folder under apps/ that is a package. */
const apps = readdirSync(appsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(appsDir, entry.name, 'package.json')))
  .map(({ name }) => name)

const withoutComments = (css: string): string => css.replaceAll(/\/\*[\s\S]*?\*\//g, '')

/** The value a stylesheet gives a property on the body: the last one, since that one wins. */
function bodyDeclaration(path: string, property: string): string | undefined {
  const rules = withoutComments(readFileSync(path, 'utf8')).matchAll(
    /(?:^|\n)\s*body\s*\{([^}]*)\}/g,
  )
  const values = [...rules].flatMap(([, rule]) =>
    [...(rule ?? '').matchAll(new RegExp(`(?:^|[\\s;])${property}:\\s*([^;]+)`, 'g'))].map(
      ([, value]) => value?.trim(),
    ),
  )
  return values.at(-1)
}

const BODY = [
  ['background', 'var(--color-bg)', '--color-bg'],
  ['color', 'var(--color-text)', '--color-text'],
  ['font-family', 'var(--font-sans)', '--font-sans'],
  ['line-height', 'var(--leading)', '--leading'],
] as const

it('finds the apps, so that the checks below cannot pass by checking none', () => {
  expect(apps).toContain('ts-docs')
})

describe.each(apps)('%s', (app) => {
  const stylesheet = join(appsDir, app, 'app/globals.css')

  it('loads its global stylesheet in the root layout', () => {
    expect(readFileSync(join(appsDir, app, 'app/layout.tsx'), 'utf8')).toMatch(
      /^import '\.\/globals\.css'$/m,
    )
  })

  it('imports the ui tokens itself, before any rule, since CSS ignores an import after one', () => {
    expect(withoutComments(readFileSync(stylesheet, 'utf8')).trimStart()).toMatch(
      /^@import '@docs-rag-lab\/ui\/tokens\.css';/,
    )
  })

  it('resolves that import to the file that defines what the body reads', () => {
    const tokens = withoutComments(
      readFileSync(
        createRequire(join(appsDir, app, 'package.json')).resolve('@docs-rag-lab/ui/tokens.css'),
        'utf8',
      ),
    )

    for (const [, , token] of BODY) expect(tokens).toContain(`${token}:`)
  })

  it.each(BODY)(
    'gives the body the same %s as Storybook, so a page cannot pass in one and fail in the other',
    (property, value) => {
      expect(bodyDeclaration(stylesheet, property)).toBe(value)
      expect(bodyDeclaration(storybook, property)).toBe(value)
    },
  )
})
