# Docs RAG Lab

Docs RAG Lab (repository `docs-rag-lab`) is a local RAG engine and set of apps over official technical documentation (TypeScript and React first). It has:
- docs assistants with native citations;
- a retrieval inspector;
- an evaluation harness;
- an interview-prep app.

The full spec is in `SPEC.md`. Read the sections relevant to your task before planning. It is deliberately not imported here, to keep this file small.

## Current milestone

M0 - Scaffold (see SPEC.md section 13). Update this line when a milestone is done.

## Commands

Fill this in during M0 with the real, working commands. Never list a command that has not been run successfully.

- Install: `pnpm install`
- All checks: `pnpm turbo run lint typecheck test`
- One package: `pnpm turbo run test --filter=<package>`
- App dev server: `pnpm --filter <app> dev`

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
- Before committing a milestone, run the `code-reviewer` subagent (once it exists).

## Never

- Read or print `.env*` files, or commit secrets.
- Write to `data/` or `.cache/` by hand. These are generated.
- Add LangChain, LlamaIndex or other RAG frameworks.
- Hardcode model IDs or prices outside config.
- Use em dashes in any text: docs, comments, commit messages, UI copy. Use plain hyphens.
