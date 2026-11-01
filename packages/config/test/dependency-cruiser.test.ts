// Proves that every boundary rule fires on a deliberate violation and stays
// quiet on allowed imports. The fixture under __fixtures__/boundaries is a
// miniature copy of the repository layout; each violating file names its rule.
import { fileURLToPath } from 'node:url'

import { cruise } from 'dependency-cruiser'
import { beforeAll, describe, expect, it } from 'vitest'

import config from '../dependency-cruiser.cjs'

const fixtureRoot = fileURLToPath(new URL('../__fixtures__/boundaries/', import.meta.url))

let violations: { rule: string; from: string; to: string }[] = []

/** The `from -> to` pairs that broke `rule`, sorted. */
function edges(rule: string): string[] {
  return violations
    .filter((violation) => violation.rule === rule)
    .map((violation) => `${violation.from} -> ${violation.to}`)
    .sort()
}

beforeAll(async () => {
  const result = await cruise(['apps', 'packages', 'tooling'], {
    ...config.options,
    baseDir: fixtureRoot,
    validate: true,
    ruleSet: { forbidden: config.forbidden },
  })
  if (typeof result.output === 'string') throw new Error('expected a JSON cruise result')
  violations = result.output.summary.violations.map((violation) => ({
    rule: violation.rule.name,
    from: violation.from,
    to: violation.to,
  }))
})

describe('boundary rules (SPEC section 4)', () => {
  it('packages never import apps', () => {
    expect(edges('packages-not-to-apps')).toEqual([
      'packages/core/src/imports-app.ts -> apps/alpha/src/index.ts',
    ])
  })

  it('apps never import other apps', () => {
    expect(edges('apps-not-to-apps')).toEqual([
      'apps/alpha/src/imports-app.ts -> apps/beta/src/index.ts',
    ])
  })

  it('sources import only source-kit', () => {
    expect(edges('sources-only-source-kit')).toEqual([
      'packages/sources/typescript/src/imports-core.ts -> packages/core/src/index.ts',
      'packages/sources/typescript/src/imports-db.ts -> packages/db/src/index.ts',
      'packages/sources/typescript/src/imports-other-source.ts -> packages/sources/react/src/index.ts',
    ])
  })

  it('core imports only source-kit, db, contracts and settings', () => {
    expect(edges('core-allowed-packages')).toEqual([
      'packages/core/src/imports-app.ts -> apps/alpha/src/index.ts',
      'packages/core/src/imports-source.ts -> packages/sources/typescript/src/index.ts',
      'packages/core/src/imports-ui.ts -> packages/ui/src/index.ts',
    ])
  })

  it('ui imports no internal package but contracts, not even types', () => {
    expect(edges('ui-no-internal-packages')).toEqual([
      'packages/ui/src/imports-core-type.ts -> packages/core/src/index.ts',
      'packages/ui/src/imports-core.ts -> packages/core/src/index.ts',
      'packages/ui/src/imports-db.ts -> packages/db/src/index.ts',
      'packages/ui/src/imports-settings.ts -> packages/settings/src/index.ts',
    ])
  })

  it('ui imports no Node.js built-ins', () => {
    expect(edges('ui-no-node-builtins')).toEqual(['packages/ui/src/imports-node.ts -> fs'])
  })

  it('contracts imports no internal package', () => {
    expect(edges('contracts-is-leaf')).toEqual([
      'packages/contracts/src/imports-core.ts -> packages/core/src/index.ts',
    ])
  })

  it('contracts imports no Node.js built-ins and no npm packages', () => {
    const found = edges('contracts-client-safe')

    expect(found).toContain('packages/contracts/src/imports-node.ts -> fs')
    expect(
      found.filter((edge) => edge.startsWith('packages/contracts/src/imports-npm.ts -> ')),
    ).toHaveLength(1)
    expect(found.every((edge) => /imports-(node|npm)\.ts/.test(edge))).toBe(true)
  })

  it('core imports only types from settings', () => {
    expect(edges('core-settings-types-only')).toEqual([
      'packages/core/src/imports-settings-value.ts -> packages/settings/src/index.ts',
    ])
  })

  it('settings imports no internal package', () => {
    expect(edges('settings-is-leaf')).toEqual([
      'packages/settings/src/imports-core.ts -> packages/core/src/index.ts',
    ])
  })

  it('source-kit imports no internal package', () => {
    expect(edges('source-kit-is-leaf')).toEqual([
      'packages/source-kit/src/imports-core.ts -> packages/core/src/index.ts',
      'packages/source-kit/src/imports-db.ts -> packages/db/src/index.ts',
    ])
  })

  it('db imports no internal package', () => {
    expect(edges('db-is-leaf')).toEqual([
      'packages/db/src/imports-core.ts -> packages/core/src/index.ts',
    ])
  })

  it('config imports no internal package, so it cannot launder an import', () => {
    expect(edges('config-is-leaf')).toEqual([
      'packages/config/launder.ts -> packages/core/src/index.ts',
    ])
  })

  it('nothing imports tooling', () => {
    expect(edges('tooling-not-imported')).toEqual([
      'packages/cli/src/imports-tooling.ts -> tooling/hooks/src/index.ts',
    ])
  })

  it('other packages are imported only through src/index.ts', () => {
    expect(edges('no-deep-imports')).toEqual([
      'apps/alpha/src/imports-app.ts -> apps/beta/src/index.ts',
      'packages/cli/src/deep-import.ts -> packages/core/src/internal.ts',
      'packages/core/src/imports-app.ts -> apps/alpha/src/index.ts',
    ])
  })

  it('flags every relative import that crosses a package root', () => {
    const crossing = edges('no-relative-cross-package')

    expect(crossing).toContain('packages/cli/src/deep-import.ts -> packages/core/src/internal.ts')
    expect(crossing).toContain('apps/alpha/src/index.ts -> packages/core/src/index.ts')
    expect(crossing.some((edge) => edge.startsWith('packages/core/src/same-package.ts'))).toBe(
      false,
    )
  })

  it('allows the imports the architecture intends', () => {
    const allowed = [
      'apps/alpha/src/index.ts -> packages/core/src/index.ts',
      'packages/core/src/index.ts -> packages/source-kit/src/index.ts',
      'packages/core/src/index.ts -> packages/db/src/index.ts',
      'packages/core/src/index.ts -> packages/contracts/src/index.ts',
      'packages/core/src/imports-settings-type.ts -> packages/settings/src/index.ts',
      'packages/ui/src/imports-contracts.ts -> packages/contracts/src/index.ts',
      'packages/core/src/same-package.ts -> packages/core/src/internal.ts',
      'packages/sources/typescript/src/same-package.ts -> packages/sources/typescript/src/internal.ts',
      'packages/sources/typescript/src/index.ts -> packages/source-kit/src/index.ts',
      'packages/cli/src/index.ts -> packages/core/src/index.ts',
      'packages/cli/src/index.ts -> packages/sources/typescript/src/index.ts',
    ]
    const boundaryViolations = violations
      .filter((violation) => violation.rule !== 'no-relative-cross-package')
      .map((violation) => `${violation.from} -> ${violation.to}`)

    for (const edge of allowed) expect(boundaryViolations).not.toContain(edge)
  })

  it('sees npm packages, so an undeclared one is caught', () => {
    // Until M3 the exclude pattern dropped node_modules and dist/ paths, so no
    // npm import reached the rules at all.
    expect(edges('no-non-package-json').map((edge) => edge.split(' -> ')[0])).toEqual([
      'packages/cli/src/undeclared-npm.ts',
    ])
  })

  it('finds no cycles or unresolvable imports in the fixture', () => {
    expect([...edges('no-circular'), ...edges('not-to-unresolvable')]).toEqual([])
  })
})
