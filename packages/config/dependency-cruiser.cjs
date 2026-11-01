// @ts-check
// Architecture boundaries from SPEC section 4, enforced in CI (through `lint`)
// and in the Claude Code PostToolUse hook. Each rule's comment names the rule
// it enforces, so a failing check explains itself. Covered by
// test/dependency-cruiser.test.ts against __fixtures__/boundaries.

// A package root: packages/sources/<id>, packages/<name> or apps/<name>.
const PACKAGE_ROOT = '^(packages/sources/[^/]+|packages/(?!sources/)[^/]+|apps/[^/]+)/'
// The only file another package may import: its public src/index.ts.
const PUBLIC_ENTRY = '^(packages/sources/[^/]+|packages/(?!sources/)[^/]+)/src/index\\.ts$'
// Anything that belongs to this repository.
const INTERNAL = '^(apps|packages|tooling)/'
// Shared tsconfig, eslint and vitest presets may be imported from anywhere.
const CONFIG = '^packages/config/'

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'packages-not-to-apps',
      comment: 'Packages never import apps (SPEC section 4).',
      severity: 'error',
      from: { path: '^packages/' },
      to: { path: '^apps/' },
    },
    {
      name: 'apps-not-to-apps',
      comment: 'An app never imports another app. Move shared code into a package (ADR-0002).',
      severity: 'error',
      from: { path: '^apps/([^/]+)/' },
      to: { path: '^apps/', pathNot: '^apps/$1/' },
    },
    {
      name: 'sources-only-source-kit',
      comment:
        'packages/sources/* import only @docs-rag-lab/source-kit: no core, no db, no ui, no other source (SPEC section 4).',
      severity: 'error',
      from: { path: '^packages/sources/([^/]+)/' },
      to: {
        path: INTERNAL,
        pathNot: ['^packages/sources/$1/', '^packages/source-kit/', CONFIG],
      },
    },
    {
      name: 'core-allowed-packages',
      comment:
        'core imports only source-kit, db, contracts and settings (types only): never ui, a concrete source or an app (SPEC section 4, ADR-0002, ADR-0006, ADR-0007).',
      severity: 'error',
      from: { path: '^packages/core/' },
      to: {
        path: INTERNAL,
        pathNot: ['^packages/(core|source-kit|db|contracts|settings)/', CONFIG],
      },
    },
    {
      name: 'core-settings-types-only',
      comment:
        'core imports only types from settings: model IDs and prices reach core as arguments, never as imported values (ADR-0007).',
      severity: 'error',
      from: { path: '^packages/core/' },
      to: { path: '^packages/settings/', dependencyTypesNot: ['type-only'] },
    },
    {
      name: 'settings-is-leaf',
      comment:
        'settings imports no other internal package: it is plain data and its schema, shared by the CLI and apps (ADR-0007).',
      severity: 'error',
      from: { path: '^packages/settings/' },
      to: { path: INTERNAL, pathNot: ['^packages/settings/', CONFIG] },
    },
    {
      name: 'ui-no-internal-packages',
      comment:
        'ui is client-safe: it imports no internal package but contracts, not even types from core or db. It talks to app route handlers (SPEC section 4, ADR-0006).',
      severity: 'error',
      from: { path: '^packages/ui/' },
      to: { path: INTERNAL, pathNot: ['^packages/(ui|contracts)/', CONFIG] },
    },
    {
      name: 'contracts-is-leaf',
      comment:
        'contracts imports no other internal package, so ui can import it without reaching core or db (ADR-0006).',
      severity: 'error',
      from: { path: '^packages/contracts/' },
      to: { path: INTERNAL, pathNot: ['^packages/contracts/', CONFIG] },
    },
    {
      name: 'contracts-client-safe',
      comment:
        'contracts imports nothing but its own files: no Node.js built-ins and no npm packages, so it runs in the browser and in Node. Its tests may import vitest (ADR-0006).',
      severity: 'error',
      from: { path: '^packages/contracts/src/', pathNot: '\\.test\\.ts$' },
      to: { dependencyTypesNot: ['local'] },
    },
    {
      name: 'ui-no-node-builtins',
      comment: 'ui is client-safe: it never imports Node.js built-in modules (SPEC section 4).',
      severity: 'error',
      from: { path: '^packages/ui/src/' },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'source-kit-is-leaf',
      comment:
        'source-kit is a leaf package: it imports no other internal package, so every source stays a pure parser. The embedding cache lives in core (ADR-0003).',
      severity: 'error',
      from: { path: '^packages/source-kit/' },
      to: { path: INTERNAL, pathNot: ['^packages/source-kit/', CONFIG] },
    },
    {
      name: 'db-is-leaf',
      comment: 'db is a leaf package: it imports no other internal package (ADR-0002).',
      severity: 'error',
      from: { path: '^packages/db/' },
      to: { path: INTERNAL, pathNot: ['^packages/db/', CONFIG] },
    },
    {
      name: 'config-is-leaf',
      comment:
        'config imports no other internal package. Every rule exempts config, so a re-export through it would launder any import (ADR-0002).',
      severity: 'error',
      from: { path: '^packages/config/' },
      to: { path: INTERNAL, pathNot: '^packages/config/' },
    },
    {
      name: 'tooling-not-imported',
      comment: 'Apps and packages never import tooling/ (repo checks and Claude Code hooks).',
      severity: 'error',
      from: { path: '^(apps|packages)/' },
      to: { path: '^tooling/' },
    },
    {
      name: 'no-deep-imports',
      comment:
        'Import another package only through its public src/index.ts, never its internals (SPEC section 4).',
      severity: 'error',
      from: { path: PACKAGE_ROOT },
      to: { path: '^(apps|packages)/', pathNot: ['^$1/', PUBLIC_ENTRY, CONFIG] },
    },
    {
      name: 'no-relative-cross-package',
      comment:
        'Never reach into another package with a relative path. Declare a workspace dependency and import it by name.',
      severity: 'error',
      from: { path: PACKAGE_ROOT },
      to: { dependencyTypes: ['local'], path: INTERNAL, pathNot: '^$1/' },
    },
    {
      name: 'no-circular',
      comment: 'Circular imports make modules hard to reason about and to load.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'not-to-unresolvable',
      comment: 'Every import must resolve to a file or an installed package.',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'no-non-package-json',
      comment: 'Every npm import must be declared in the importing package.json.',
      severity: 'error',
      from: {},
      to: { dependencyTypes: ['npm-no-pkg', 'npm-unknown'] },
    },
  ],
  options: {
    // npm packages stay in the graph, so rules can see them, but are not followed.
    doNotFollow: { path: 'node_modules' },
    // Fixture and generated folders. Not node_modules or dist/: excluding those
    // dropped every npm package from the graph (packages have no build step, ADR-0001).
    exclude: { path: '(^|/)(__fixtures__|\\.next|\\.turbo|coverage)/' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      mainFields: ['module', 'main', 'types'],
      extensions: ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json'],
    },
  },
}
