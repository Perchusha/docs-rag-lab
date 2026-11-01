# Docs RAG Lab

Docs RAG Lab (repository `docs-rag-lab`) is a local RAG engine and set of apps over official technical documentation (TypeScript and React first). It has:
- docs assistants with native citations;
- a retrieval inspector;
- an evaluation harness;
- an interview-prep app.

The full spec is in `SPEC.md`. Read the sections relevant to your task before planning. It is deliberately not imported here, to keep this file small.

## Current milestone

M3 - ts-docs app (see SPEC.md section 13). M0, M1 and M2 are done. Update this line when a milestone is done.

## Commands

Requires Node 26.13.0 and pnpm 12.16.1. Never list a command here that has not been run successfully.

- Install: `pnpm install`
- All checks, as CI runs them: `pnpm format:check` and `pnpm turbo run lint typecheck test`
- One package: `pnpm turbo run test --filter=@docs-rag-lab/core` (also works with `lint` and `typecheck`)
- Changed packages and their dependents: `pnpm turbo run test "--filter=...[HEAD]"`
- Typecheck every commit of the branch: `git rebase --exec "pnpm install --frozen-lockfile --offline && pnpm turbo run typecheck" $(git merge-base HEAD origin/main)` (needs a clean tree; it replays the commits on their own base, so nothing is rewritten, and stops at the first commit that fails)
- Boundary check only: `pnpm depcruise` (`lint` already runs it)
- Format: `pnpm format`
- Sync a source: `pnpm drl sync typescript` (add `--full` to re-parse everything; only changed chunks are re-embedded)
- Ask: `pnpm drl ask "<question>"` (add `--verbose` to see the retrieval trace)
- Retrieval only, no Claude call: `pnpm drl search "<question>"` (add `--strategy vector` for vector search only, `--doc-type option` to filter, `--json` for the whole trace; `ask` takes the same flags)
- Embedding rate limits: `pnpm drl limits`
- Network smoke test, spends real tokens: `pnpm test:network`

`drl` and `test:network` call paid APIs; the CLI loads keys itself, so never pass a dotenv file on the command line. Voyage is on the Atlas free trial (3 requests and 10K tokens per minute): a full index takes about an hour, so run it in the background. There is no app dev server until M3.

## Hooks

`.claude/settings.json` runs the hooks in `tooling/claude-hooks` (ADR-0002):
- before a tool call, block anything that names a `.env*` file, and file-tool writes to `data/` or `.cache/`;
- after an edit, run lint, typecheck and depcruise for that package;
- before stopping, run tests and depcruise for packages changed since HEAD. This also covers edits made through the shell.

When a hook reports an error, fix the cause. Never weaken the hook or the rule. The guard matches text, so do not name `.env*` files in commands or commit messages at all.

## Architecture boundaries

These are enforced by dependency-cruiser. Do not work around them.

- Apps import packages. Packages never import apps.
- `packages/sources/*` import only `@docs-rag-lab/source-kit`.
- `core` imports `source-kit` and `db`, never `ui`.
- `ui` is client-safe: no imports from `core` or `db`.
- Import a package only through its public `index.ts`.

## Definition of done

A task is done when all of these hold:
- typecheck, lint and tests pass for affected packages;
- the dependency-cruiser check passes;
- new behavior has tests;
- unit tests use fixtures and never the network;
- SPEC.md or the README is updated if behavior or architecture changed;
- a non-obvious decision has an ADR in `docs/adr/`;
- after a milestone, there is an entry in `docs/journal.md` with before/after metrics where relevant.

## How to work

- For changes touching more than one package: plan first, list the files you will touch, and wait for approval.
- Propose new dependencies in the plan, with a reason. Prefer small, well-maintained ones. Check current versions on npm instead of guessing.
- Keep commits small, with conventional commit messages.
- Every commit must pass typecheck on its own, not just the branch head. Put a type before its consumers, or both in one commit. Run the per-commit check (Commands) before pushing.
- Before committing a milestone, run the `code-reviewer` subagent (once it exists).

## Never

- Read or print `.env*` files, or commit secrets.
- Write to `data/` or `.cache/` by hand. These are generated.
- Add LangChain, LlamaIndex or other RAG frameworks.
- Hardcode model IDs or prices outside config.
- Use em dashes in any text: docs, comments, commit messages, UI copy. Use plain hyphens.
