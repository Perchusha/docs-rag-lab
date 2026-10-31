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
      name: 'core-only-source-kit-db',
      comment:
        'core imports only source-kit and db: never ui, a concrete source or an app (SPEC section 4, ADR-0002).',
      severity: 'error',
      from: { path: '^packages/core/' },
      to: { path: INTERNAL, pathNot: ['^packages/(core|source-kit|db)/', CONFIG] },
    },
    {
      name: 'ui-no-internal-packages',
      comment:
        'ui is client-safe: it never imports core, db or any other internal package, not even types. It talks to app route handlers (SPEC section 4).',
      severity: 'error',
      from: { path: '^packages/ui/' },
      to: { path: INTERNAL, pathNot: ['^packages/ui/', CONFIG] },
    },
    {
      name: 'ui-no-node-builtins',
      comment: 'ui is client-safe: it never imports Node.js built-in modules (SPEC section 4).',
      severity: 'error',
      from: { path: '^packages/ui/src/' },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'source-kit-only-db',
      comment:
        'source-kit is a foundation package: it may import only db (ADR-0002, revisit in M1).',
      severity: 'error',
      from: { path: '^packages/source-kit/' },
      to: { path: INTERNAL, pathNot: ['^packages/(source-kit|db)/', CONFIG] },
    },
    {
      name: 'db-is-leaf',
      comment: 'db is a leaf package: it imports no other internal package (ADR-0002).',
      severity: 'error',
      from: { path: '^packages/db/' },
      to: { path: INTERNAL, pathNot: ['^packages/db/', CONFIG] },
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
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(node_modules|__fixtures__|\\.next|\\.turbo|dist|coverage)/' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      mainFields: ['module', 'main', 'types'],
      extensions: ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json'],
    },
  },
}
