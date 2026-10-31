# ADR-0002: Enforcing boundaries, and the Claude Code hooks

- Status: accepted
- Date: 2026-10-31
- Milestone: M0

## Context

SPEC section 4 sets five dependency rules and says that dependency-cruiser enforces them in CI and in Claude Code hooks. SPEC section 12 asks for three hooks:
- PostToolUse: typecheck, lint and depcruise for the touched package;
- Stop: tests for affected packages;
- PreToolUse: block `.env*` reads and writes to `data/` and `.cache/`.

M0's acceptance criterion: a deliberate boundary violation fails both CI and the hook. SPEC leaves open where the rules run, what the hooks do outside the obvious cases, and how much a hook may cost per edit.

## Decision

### 1. The rules

The rules live in `packages/config/dependency-cruiser.cjs`. The root `.dependency-cruiser.cjs` re-exports them, so the CLI finds them. Each rule's `comment` names the rule it enforces, so a failure explains itself.

| Rule | Source |
|---|---|
| `packages-not-to-apps` | SPEC |
| `sources-only-source-kit` (no other source either) | SPEC |
| `core-only-source-kit-db` | SPEC. Read as an allowlist: core never imports a concrete source; apps and the CLI pass sources in |
| `ui-no-internal-packages` (type-only imports included) | SPEC "client-safe", read strictly |
| `ui-no-node-builtins` | SPEC "client-safe" |
| `no-deep-imports` (only `src/index.ts`; `packages/config` is exempt, because it serves presets through subpaths) | SPEC |
| `apps-not-to-apps` | added: apps are leaves; shared code belongs in a package |
| `source-kit-only-db`, `db-is-leaf` | added: foundation packages stay at the bottom of the graph. Revisit in M1, when it is decided where the embedding cache lives |
| `no-relative-cross-package` | added: `../../core/src/x.ts` bypasses both `exports` and the package.json dependency list |
| `config-is-leaf` | added after the M0 review: every rule exempts `packages/config` (presets), so without this a re-export through config would launder any import. The reviewer proved it with `ui -> config -> core` |
| `tooling-not-imported` | added: repo checks and hooks are not product code |
| `no-circular`, `not-to-unresolvable`, `no-non-package-json` | standard hygiene |

`tsPreCompilationDeps: true` makes type-only imports count. Workspace imports resolve through pnpm's symlinks to real paths, so `@docs-rag-lab/core` is seen as `packages/core/src/index.ts`, and path rules apply to them.

Known limits, accepted for now:
- dependency-cruiser cannot see imports with computed paths, such as ``import(`../${name}/src/index.ts`)``;
- `tooling/*` is not constrained by the package rules (it imports nothing internal today);
- on Windows, a mis-cased path such as `../Apps/x` resolves locally. CI runs on Linux, where it fails as unresolvable.

Open question for M2-M3: core produces the trace and citation shapes that ui renders, but ui may not import core, not even types. Those shapes need a types-only home, or ui defines its own view types. Decide that in an ADR when it comes up.

### 2. Where the check runs

A root Turborepo task, `//#depcruise`, is a dependency of every package's `lint` and `test` tasks.
- The literal acceptance command, `pnpm turbo run lint typecheck test`, therefore always checks boundaries.
- So do the PostToolUse hook (lint) and the Stop hook (test). The Stop hook matters because edits made through the shell skip PostToolUse.
- Turbo runs the task once per invocation.
- The task is uncached: it takes well under a second, and a stale pass would be worse than useless.

### 3. The rules are tested

`packages/config/__fixtures__/boundaries/` is a miniature copy of the repository layout:
- one deliberately violating file per rule, named after the rule;
- plus files that make the allowed imports.

`test/dependency-cruiser.test.ts` runs the real rule set over it and asserts the exact set of violations per rule. If a rule is broken by a regex change, or silently stops matching, CI fails. One detail: dependency-cruiser reports `node:fs` as `fs`.

### 4. Hooks are a tested workspace package

The hooks are TypeScript in `tooling/claude-hooks`, run as `node <file>.ts` (Node 26 type stripping, ADR-0001). They are invoked in exec form with `${CLAUDE_PROJECT_DIR}`. The pure logic sits in `src/lib/` with unit tests, and the hooks go through the same lint, typecheck and test pipeline as everything else. They are not loose scripts in `.claude/`.

**guard-paths (PreToolUse):**
- `.env` is matched as a file name, not a substring, and case-insensitively, because NTFS opens `.ENV` as `.env`.
  - It counts unless it directly follows a word character, `$` or `.`. The name runs to the next separator.
  - Denied: `.env`, `./.env.local`, `cat .env`, `--env-file=.env`, `cat<.env`, `Get-Content -Path:.env`, `.envrc`.
  - Allowed: `process.env`, `import.meta.env`, `production.env` and `.env.example`.
  - The first version accepted only a few separators before the name. The M0 review found `.ENV`, `cat<.env` and `README.md,.env` getting through, and the boundary set was widened.
- What is checked per tool:
  - file tools: the path;
  - Grep: `path` and `glob`;
  - Glob: `path` and `pattern`;
  - Bash and PowerShell: the command text.
- Paths are normalized before the `data/` and `.cache/` check: backslashes, drive-letter case, `..`, Win32 `\\?\` prefixes and MSYS `/d/...` paths.
- Writes to `data/` and `.cache/` are denied for file tools only, because the CLI legitimately writes there through Bash.
- The guard fails closed: an unexpected error blocks the call.
- Text matching cannot see through shell globs (`cat .e*`) or tools that read everything (`rg --no-ignore`). `permissions.deny` in `.claude/settings.json` is a second layer. In practice those rules catch `data/` and `.cache/` writes before the hook even runs.
- Known false positive: any command whose text names a dotenv file is blocked, even a commit message. M0 hit this once; the fix is to rephrase.

**post-edit (PostToolUse):**
- Runs `pnpm turbo run lint typecheck --filter=<package>` (lint pulls in depcruise) for the package that owns the edited file. Markdown and files outside workspace packages are skipped.
- Exit 2 sends the errors back to Claude. Every run reports its own duration.
- Budget: if a typical run took more than about 8s, lint would move to the Stop hook. It was measured on the M0 scaffold, with each package's cache forced to miss by changing a file:

  | Package | Cold | Warm |
  |---|---|---|
  | core | 2.6s | 1.1s |
  | ui | 2.4s | 1.1s |
  | source-typescript | 2.5s | 1.1s |
  | claude-hooks | 2.6s | 1.0s |
  | repo-checks | 2.6s | 1.1s |
  | config | 3.0s | 1.1s |

- The cold median is 2.6s and the max is 3.0s, well under the budget, so lint stays in PostToolUse. Re-measure when packages carry real code (M1, M3).
- With pnpm 12's default `verifyDepsBeforeRun: install`, the hook's own `pnpm turbo` call installs dependencies after a `package.json` edit, so the next check sees the new links.

**Failure modes, shared by post-edit and stop-tests:**
- A hook that cannot do its job exits 1, which is non-blocking: the user sees it, Claude is not blamed. This covers:
  - pnpm not on PATH, checked up front because cmd.exe reports an unknown command with exit code 1 and a localized message;
  - a timeout below the settings timeout;
  - a crash in the Stop hook.
- A crash in post-edit exits 2, because it is almost always caused by the edit itself, such as an invalid `package.json`. The message names the file.

**stop-tests (Stop):**
- Runs `pnpm turbo run test "--filter=...[HEAD]"`, which includes the boundary check. Turbo's comparison includes uncommitted and untracked files (checked with `--dry=json`).
- Before the first commit there is no HEAD, so it runs everything.
- A failure exits 2 once. If `stop_hook_active` is set, meaning Claude already had a retry, it lets Claude stop and shows the user a warning. It can never loop.

## Consequences

- A boundary violation fails in three places, with the same rule text each time:
  - the PostToolUse hook (about 1s after the edit);
  - the Stop hook, which also covers shell edits;
  - CI.
- The cost of the edit loop is visible and measured, not guessed.
- The guard is conservative. An occasional false positive is accepted in exchange for never reading a secret.
- A loosening of the deny rules has to come from the user: the agent's own attempt to relax them for a demo was refused by Claude Code's auto-mode classifier.

## Alternatives considered

- **`turbo boundaries` or eslint-plugin-boundaries.** SPEC names dependency-cruiser. It also expresses path rules with capture groups (`$1`) and dependency types (`core`, `type-only`), which these lack or handle less directly.
- **Running dependency-cruiser per package inside each `lint` script.** Each package would need a relative path to the shared config, and it would cost more. One root run is simpler.
- **Hooks as `.mjs` files under `.claude/hooks/`.** They would be untyped, unlinted and untested. Rejected: the guard is security-relevant.
- **Moving lint to the Stop hook from the start.** Not needed at the measured cost. That stays the fallback.
