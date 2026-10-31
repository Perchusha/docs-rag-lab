# ADR-0001: Stack and tooling versions

- Status: accepted
- Date: 2026-10-31
- Milestone: M0
- Amended: 2026-10-31, M1 (runtime dependencies, type stripping verified)

## Context

SPEC section 5 names the stack: current Node LTS, pnpm, Turborepo, strict TypeScript, ESM, Vitest, ESLint, Prettier, dependency-cruiser, Storybook and Next.js. It names no versions. M0 must pin versions that are current, verified, and compatible with what later milestones need, especially twoslash (M7), which drives the TypeScript compiler through its JS API.

All versions below were checked with `npm view` on 2026-10-31. The resolved versions are the ones in `pnpm-lock.yaml`.

## Decision

| Tool | Version | Why |
|---|---|---|
| Node | 26.13.0 | Became Active LTS ("Lithium") on 2026-10-28. Pinned in `.nvmrc`; `engines` plus pnpm `engineStrict` (`^26.13.0`) make `pnpm install` refuse anything else |
| pnpm | 12.16.1 | Latest. Set in the `packageManager` field. Shared tool versions live in one `catalog:` in `pnpm-workspace.yaml` |
| Turborepo | 2.11.10 | Turborepo itself is developed on pnpm 12 and parses pnpm 12 lockfiles |
| TypeScript | 6.0.3 | See "TypeScript 6, not 7" below |
| ESLint | 10.13.0 (range `^10.13.0`) | Flat config. 10.14.0 was less than a day old, see "Supply-chain defaults" |
| typescript-eslint | 8.72.1 | `strictTypeChecked` + `stylisticTypeChecked`, with `projectService` |
| @eslint-community/eslint-plugin-eslint-comments | 4.8.1 | `require-description` turns SPEC's "no `any` without an explaining comment" into a lint error |
| Prettier | 3.9.10 | No semicolons, single quotes, width 100, matching the SPEC code samples |
| Vitest / Vite | 5.0.5 / 8.3.5 | Vite is a peer dependency of Vitest 5, so it is installed explicitly |
| dependency-cruiser | 18.7.0 | Boundary rules, see ADR-0002 |
| @types/node | 26.6.6 | Matches Node 26 |
| GitHub Actions | checkout@v7, setup-node@v7, pnpm/action-setup@v6 | Current majors. setup-node reads `.nvmrc`; action-setup reads `packageManager` |

Deferred until the milestone that uses them, so that M0 installs nothing unused:
- Next.js 16.4 and React 19.3 (M3);
- Storybook 10 (M3);
- better-sqlite3 13 and sqlite-vec 0.1.9 (M1, added; see "M1 additions" below);
- `@anthropic-ai/sdk` and `voyageai` (M1, added);
- `@turbo/gen` (before M6).

### TypeScript 6, not 7

TypeScript 7.0.2 is the latest release, and it is the native (Go) compiler. Its npm package exposes only an `unstable/*` API, not the JS compiler API the ecosystem uses. Three tools this project needs have peer ranges that exclude it:
- typescript-eslint 8.72.1: `typescript >=4.8.4 <6.1.0`;
- dependency-cruiser 18.7.0: `typescript <7.0.0`;
- twoslash 0.3.9: `typescript ^5.5.0 || ^6.0.0`.

So the project uses 6.0.3, the last JS-based line, pinned with `~6.0.3`. Revisit when typescript-eslint and twoslash support TypeScript 7.

### Internal packages have no build step

Every package's `package.json` exports `{ ".": "./src/index.ts" }`.
- Next.js, Vitest and Node 26 all consume TypeScript source directly. There is no `build` task, no `dist/`, and no project references.
- `exports` exposing only `.` also enforces SPEC's "only through index.ts" at the resolver level.

The shared tsconfig presets (`packages/config/tsconfig/`) make this safe:
- `verbatimModuleSyntax` and `erasableSyntaxOnly`: only syntax that type stripping can erase (no enums or namespaces);
- `allowImportingTsExtensions` with `noEmit`: relative imports use real extensions (`./guard.ts`).
- `module` and `moduleResolution` are `nodenext`. The `react` preset uses `preserve` and `bundler` instead, for code that a bundler consumes.

Result: Node runs tooling directly with no loader, for example `node tooling/claude-hooks/src/guard-paths.ts`.

Risk, resolved in M1: the CLI imports workspace packages through pnpm's `node_modules` links, and Node does not strip types inside `node_modules`. Node resolves links to real paths by default, so the files are stripped. Verified on Windows with a probe through an NTFS junction (no warning; `import.meta.resolve` returns the real path), and in CI by a CLI test that spawns `node packages/cli/src/bin.ts --help`. No `tsx`.

### M1 additions

Checked with `npm view` on 2026-10-31. Each is a dependency of the one package that uses it, so none is in the catalog.

| Package | Version | Where | Notes |
|---|---|---|---|
| better-sqlite3 | 13.0.3 | db | First N-API release; prebuilds for win32-x64 and linux-x64 ship inside the package and there is no install script, so pnpm 12 needs no `allowBuilds` entry |
| @types/better-sqlite3 | 9.6.0 | db (dev) | better-sqlite3 bundles no types |
| sqlite-vec | 0.1.9 | db | Platform binaries as optional dependencies, no install script |
| @anthropic-ai/sdk | 1.3.0 | core | Sends API version `2026-10-21`: no sampling parameters on Messages requests |
| voyageai | 0.4.0 | core | Official client; its only dependency is node-fetch 2 |
| unified, remark-parse, remark-frontmatter, remark-gfm | 11.0.5, 11.0.0, 5.0.0, 4.0.1 | source-typescript | mdast with source offsets |
| @types/mdast | 4.0.4 | source-typescript (dev) | |
| yaml | 2.9.1 | source-typescript | Frontmatter |
| github-slugger | 2.0.0 | source-typescript | Heading anchors as on typescriptlang.org |

### Turborepo task graph: transit nodes

`lint`, `typecheck` and `test` depend on a `transit` task that has no script, plus `^transit`.
- A package's cache hash then includes its internal dependencies, for example `@docs-rag-lab/config`, so a change to a preset invalidates every package that uses it.
- Tasks still run in parallel, because none waits for another package's lint or tests.

### Supply-chain defaults stay on

pnpm 11+ will not resolve versions younger than one day (`minimumReleaseAge`). On first install, pnpm added a `minimumReleaseAgeExclude` entry for eslint 10.14.0 (published on 2026-10-30). The exclusion was removed and the range set to `^10.13.0` instead. The default protection stays intact, and the next update after 24 hours picks up 10.14.

### Line endings

`.gitattributes` forces LF (`* text=auto eol=lf`). The main development machine runs Windows with `core.autocrlf=true`, and Prettier, the em-dash check and byte-for-byte doc fixtures all expect LF.

## Consequences

- One `pnpm install` on Node 26 sets up everything. CI and local runs use the same versions.
- Contributors need Node 26 and pnpm 12 installed globally. Corepack is not an option: Node 26 does not ship it, and on Node 22 corepack fails to run pnpm 12, which is a native binary. This was observed while setting up M0.
- No build step means no publishable artifacts. That is fine: everything is private and runs locally (SPEC section 2).
- TypeScript stays one major behind until the ecosystem moves.

## Alternatives considered

- **TypeScript 7 for typechecking and 6 for tools.** Two compilers can disagree, and the `typescript` package name can resolve to only one of them per package. Rejected for now.
- **A build step (tsup or tsdown) for internal packages.** It adds `dist/` outputs, watch modes and a stale-build failure mode, and gains nothing for a local-only project. Rejected.
- **Biome instead of ESLint and Prettier.** It is faster, but it has no equivalent of typescript-eslint's type-aware rules (`no-floating-promises`, `no-unsafe-*`). Rejected.
- **Node 24.** It is still supported, but SPEC asks for the current LTS, and Node 26 became the Active LTS three days before M0.
