# Journal

Short notes per milestone, with before/after numbers where they exist. Newest first.

## Before M1 - Permission deny rules (2026-10-31)

**What changed:** `.claude/settings.json` now denies reads of dotenv files at any depth. Every path rule, for dotenv files, `data/` and `.cache/`, is anchored to the project root with a leading `/` (ADR-0002, section 5).

**Probes (Claude Code 2.1.287, each one a real tool call):**

| Probe | Before | After |
|---|---|---|
| Write `packages/core/src/data/x.ts` | denied by `Edit(./data/**)` | allowed |
| Write `packages/core/src/.cache/x.ts` | denied by `Edit(./.cache/**)` | allowed |
| Write `data/probe.txt`, `.cache/probe.txt` | denied (M0) | denied |
| Read 5 dotenv names at the root, all except `.env` (not on disk) | not probed | denied |
| Read all 6 dotenv names in `packages/core/` (not on disk) | not probed | denied |
| Read `.env.test` at the root and `apps/.env.local`, after a shell `cd` into `packages/core` (not on disk) | not probed | denied |
| Read `.env.example` | readable | readable |

**What was surprising:**
- **`./data/**` is not anchored.** Per the docs, a deny rule with one directory segment matches that directory at any depth, so the M0 rule blocked any source folder named `data`. A leading `/` anchors it.
- **Settings reload live.** The new rules applied to the next tool call in the same session.
- **A shell `cd` does not move the `/` anchor.** After `cd packages/core`, the root dotenv probes were still denied.
- **This time, auto mode allowed narrowing a deny rule.** The user asked for that exact change, unlike the refused M0 demo.

## M0 - Scaffold (2026-10-31)

**What exists now:**
- a pnpm + Turborepo monorepo with 7 package shells and 2 tooling packages;
- shared TypeScript, ESLint and Vitest presets;
- dependency-cruiser boundary rules that run on every lint;
- GitHub Actions CI;
- three Claude Code hooks that catch mistakes while Claude is still editing.

There is no RAG code yet. M0 is the floor the rest of the project stands on.

**Numbers (Windows 11, Node 26.13.0, pnpm 12.16.1):**

| What | Result |
|---|---|
| `pnpm install`, warm store | 5.9s, 174 packages (5.4s in a fresh clone) |
| `pnpm turbo run lint typecheck test`, cold | 14.5s, 31 tasks (23.8s in a fresh clone on a second drive) |
| Same, fully cached | 1.2s (30 of 31 cached; the boundary check is never cached) |
| Boundary rules | 12 architecture rules plus 3 hygiene rules. Each architecture rule is proven against deliberate violations (14 tests, 30 fixture files) |
| Hook unit tests | 85 (guard matrix, path forms, workspace lookup, failure modes, loop guard) |
| PostToolUse hook per edit | 2.6s median and 3.0s max on a cache miss, 1.1s warm (budget: 8s) |
| Boundary violation caught by the hook | 1.0s after the edit |
| Stop hook catching a broken test | 1.0s |
| CI on the M0 PR | green, 36s job ([#1](https://github.com/Perchusha/docs-rag-lab/pull/1), [run](https://github.com/Perchusha/docs-rag-lab/actions/runs/41195983216)) |
| CI on a deliberate boundary violation | red after 17s, on `ui-no-internal-packages` ([#2](https://github.com/Perchusha/docs-rag-lab/pull/2), [run](https://github.com/Perchusha/docs-rag-lab/actions/runs/41196021149)) |

**Proofs (each break reverted):**
- CI: throwaway draft PR [#2](https://github.com/Perchusha/docs-rag-lab/pull/2) made `ui` declare and import `@docs-rag-lab/core`. The `pnpm turbo run lint typecheck test` step failed with `error ui-no-internal-packages: packages/ui/src/index.ts → packages/core/src/index.ts`. The PR was then closed unmerged.
- `ui` imported `@docs-rag-lab/core`. The PostToolUse hook answered with `ui-no-internal-packages: packages/ui/src/index.ts -> packages/core/src/index.ts` and the SPEC reason.
- A type error (TS2322), an `any`, and an `eslint-disable` with no explanation were each sent back by the same hook.
- Reading or printing a dotenv file was denied. `.env.example` stayed readable.
- Writes to `data/` and `.cache/` were denied. The permission deny rules caught them first; the hook covers the same cases, as its tests and a direct run show.
- A deliberately broken test blocked Claude from finishing, until it was fixed.
- A boundary violation made through the shell, which skips PostToolUse, was caught by the Stop hook.
- An em dash added to the README failed `format:check` with `README.md:104:12`.

**What the code-reviewer subagent caught.** It ran in a fresh context before the M0 commit and verified each finding with a probe:
- **Every boundary rule could be laundered through the config package.** `ui` re-exporting core through a file in `packages/config` passed with 0 violations, because every rule exempts config so packages can load presets. Fixed with a `config-is-leaf` rule and a fixture.
- **The secret guard missed `.ENV`** (NTFS is case-insensitive), **`cat<.env` and `Get-Content README.md,.env`.** Fixed: case-insensitive matching and a wider boundary set, with a test for each case.
- **The Stop hook did not check boundaries at all,** so shell edits could slip past every hook. Fixed: `test` now depends on the boundary check.
- **Other fixes:**
  - a broken `package.json` crashed the post-edit hook silently;
  - `.gitignore` would have hidden any nested `src/data/` folder;
  - several doc claims were inaccurate.

**What was surprising:**
- **TypeScript 7 is out, but this project can't use it yet.** typescript-eslint, dependency-cruiser and twoslash all need the JS compiler API, so the project stays on 6.0.3 (ADR-0001).
- **pnpm 12 is a native binary.** Node 22's corepack can't run it, and Node 26 doesn't ship corepack, so `npm i -g pnpm` it is.
- **pnpm now refuses packages less than a day old.** It quietly wrote an exception for eslint 10.14.0. We pinned `^10.13.0` instead and kept the protection.
- **The secret guard blocked its own author.** A commit message that named a dotenv file was denied. That false positive is accepted, and documented in ADR-0002.
- **Claude Code's auto mode refused to let the agent loosen its own permission rules** for a demo. Good.

### Open items for M1
- Confirm that Node type stripping works for the `drl` CLI importing workspace packages through pnpm symlinks. A probe during the M0 review ran successfully on Windows; confirm it with real code. The fallback is `tsx`.
- Decide where the embedding cache lives (source-kit or core), and revisit the `source-kit-only-db` rule.
- Re-measure the PostToolUse hook once packages contain real code.

### Open items for M4
- Committed eval reports may quote doc text that contains U+2014; react.dev uses it. Decide then: exclude `eval/reports/**` from the em-dash check, or normalize dashes when reports are written.
