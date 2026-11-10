# Docs RAG Lab

Docs RAG Lab (repository `docs-rag-lab`) is a local RAG engine and set of apps over official technical documentation (TypeScript and React first). It has:
- docs assistants with native citations;
- a retrieval inspector;
- an evaluation harness;
- an interview-prep app.

The full spec is in `SPEC.md`. Read the sections relevant to your task before planning. It is deliberately not imported here, to keep this file small.

## Current milestone

M9 - Agentic mode (see SPEC.md section 13). M0 to M8 are done. v1.0 is M5 through M9, and from M6 on the process is lighter (ADR-0015). Update this line when a milestone is done.

## Commands

Requires Node 26.13.0 and pnpm 12.16.1. Never list a command here that has not been run successfully.

- Install: `pnpm install`
- All checks, as CI runs them: `pnpm format:check` and `pnpm turbo run lint typecheck test build` (`build` is the app's `next build`)
- Once per machine, for the ui story tests: `pnpm --filter @docs-rag-lab/ui exec playwright install --only-shell chromium`
- One package: `pnpm turbo run test --filter=@docs-rag-lab/core` (also works with `lint` and `typecheck`)
- Changed packages and their dependents: `pnpm turbo run test "--filter=...[HEAD]"`
- Typecheck every commit of the branch: `git rebase --exec "pnpm install --frozen-lockfile --prefer-offline && pnpm turbo run typecheck" $(git merge-base HEAD origin/main)` (needs a clean tree; it replays the commits on their own base, so nothing is rewritten, and stops at the first commit that fails: fix it, `git commit --amend`, then `git rebase --continue`, or `git rebase --abort` to give up)
- Boundary check only: `pnpm depcruise` (`lint` already runs it)
- Format: `pnpm format`
- Scaffold a source: `pnpm turbo gen source --args <id> <repo URL> <branch> <site URL> <dir:docType,dir:docType> "<license>" <license URL> "<attribution>"`, then `pnpm install` (the `/add-source` skill goes on from there; its conformance test fails with `no fixtures` until the parser is written)
- Sync a source: `pnpm drl sync typescript` (add `--full` to re-parse everything; only changed chunks are re-embedded; add `--at <full sha>` to index that commit instead of the head of the branch; the next sync without it returns to the head)
- The contextual index, spends real tokens: `pnpm drl sync typescript --contextual` prints the estimate and stops, add `--yes` to run it, about an hour in the background (`--pilot 10` for a pilot, which builds no index). Reruns call nothing for what `eval/contexts/` and the cache hold.
- The control index, no Claude call: `pnpm drl sync typescript --control` prints the estimate and stops, add `--yes` to run it, about an hour in the background.
- The compiled index, no Claude call: `pnpm drl sync typescript --compiled` compiles every twoslash example in under a minute, records what did not compile under `eval/compile/`, stops below 90% compiled, and prints what it would embed; add `--yes` to build it, 13 minutes the first time (ADR-0017).
- The interview bank: `pnpm drl questions typescript` writes its compiler questions to `interview/bank/`, which costs nothing, and prints the estimate of the generated ones; add `--pilot 10 --yes` for a pilot, which prints its questions and the forecast, or `--yes` for the rest, which spends real tokens (React's took 54 minutes). Reruns pay only for chunks whose text changed (ADR-0018).
- The sheet of M8's test, no API calls: `pnpm drl questions sample` writes 20 generated questions to `interview/dev/labels-bank.md`, with nothing of the checker.
- M8's test against the owner's labels, no API calls: `pnpm drl questions score <labels>` (for example `interview/labels/bank-2823ff0b5089.json`) writes `interview/bank-check.json` and `.md`, and fails if the labels are not of the current sample.
- The cards flagged as wrong in the interview-prep app, no API calls: `pnpm drl questions flagged` lists each with its reason and the bank's status, and `pnpm drl questions unflag <id>` takes one back. `pnpm drl questions reject <id> [reason]` marks a shown question `rejected-owner` in its bank, with the reason or its flag's (ADR-0018).
- Golden set against the index, no API calls: `pnpm drl eval check` (add `--accept` to rewrite the lock, after a human has reviewed the set, or for React its flagged questions (ADR-0015), or `--contextual` or `--control` for those indexes, also against the plain one's chunks, or `--draft` for `eval/questions.draft.jsonl`: which anchors do not resolve and what each question copies from the docs, and it fails above 2 fresh questions on a page)
- The walk that picks fresh golden questions, no API calls: `pnpm drl eval walk --source typescript` prints the newest 50 indexed pages and headings by git history, at the index's commit (ADR-0016). The first run clones the docs' history under the cache: about a minute and 94 MB for TypeScript.
- Retrieval metrics over the golden set, no Claude call: `pnpm drl eval` (writes a report under `eval/reports/typescript/dev/`, which git ignores; add `--name baseline` for a run to commit, which needs a clean tree, measures rerank too, one paced call per question, and prints its estimate until `--yes`; `--contextual` or `--control` for those indexes, the control under `vector` and `hybrid` only; `--strategy rerank` for that strategy alone)
- A report again, to see if it reproduces: `pnpm drl eval verify <report>` (add `--record` to write what it found next to the report, for the dashboard)
- Two reports, question by question: `pnpm drl eval compare <a> <b>` (add `--strategies hybrid,rerank` for a's `hybrid` against b's `rerank`)
- ADR-0019's test over reports together, no API calls: `pnpm drl eval pool <a> <b>` compares row 3 with row 6 over their questions together, one report a source (add `--name <name>` to write it under `eval/pooled/`, or `--rows 0,3` for two other rows)
- How a rerank score depends on the rest of its call: `pnpm drl eval rerank-check` prints its plan, and reranks with `--yes` (on a cold cache any plan first embeds the queries, in one free request)
- Answer metrics, spends real tokens: `pnpm drl eval answers` prints the estimate and stops, add `--yes` to run it (`--only <ids>` for a pilot, `--noise` to measure noise, `--name answers` for a run to commit, `--rows 0,2,3,4,5` for rows 4 and 5, which rerank, and row 5 reads the contextual index, or `--rows 0,2,3,6 --noise` for row 6, agentic, whose second answers wait 6 minutes). On a cold rerank cache it shows no estimate of the paid calls before those free calls, so `--max-usd 0.01 --yes` makes them and stops at the estimate. Reruns pay only for what is not cached.
- The judge on answers whose grade is known, spends real tokens: `pnpm drl eval judge-check --yes`
- The sheet a human labels from, with no verdicts: `pnpm drl eval label <report>` (add `--after <earlier report>` for a fresh round on other questions, `--rows 4,5` for 15 answers from those rows, or `--spot` for the 10 of a spot check, with `--after <earlier report>` for a fresh one that shows none of that report's spot check (ADR-0017))
- The judge spot-checked on a source's own answers, from that sheet: `pnpm drl eval spot-check <report> <labels>` (ADR-0016; it decides no calibration; add `--after <earlier report>` for the labels of a fresh one, ADR-0017)
- How often those labels agree with the judge, which also writes what named reports' markdown says of it: `pnpm drl eval calibrate <report> <labels>` (add `--after <earlier report>` for a fresh round, `--sample-of <earlier report>` for earlier labels against new verdicts, which is not blind, or `--rows 4,5` for that round)
- Ask: `pnpm drl ask "<question>"` (add `--verbose` to see the retrieval trace)
- Retrieval only, no Claude call: `pnpm drl search "<question>"` (add `--strategy vector` for vector search only, `--doc-type option` to filter, `--json` for the whole trace; `ask` takes the same flags)
- Rate limits of embeddings and rerank: `pnpm drl limits`
- Network smoke test, spends real tokens: `pnpm test:network`
- The ts-docs app: `pnpm dev` (http://127.0.0.1:3000; the inspector's toggle and Search only make no Claude call, and its Reranker tab makes one free Voyage call and no Claude call; `/eval` is the dashboard, which only reads committed reports)
- The react-docs app: `pnpm dev:react` (http://127.0.0.1:3001; the same routes and costs as ts-docs)
- The interview-prep app: `pnpm dev:interview` (http://127.0.0.1:3002; practice calls no model, but each Check my answer on a card, like each graded answer of the mock interview, makes one hybrid search and one call to Claude, about a cent; its progress, flags and mock interviews are in `data/apps/interview-prep.sqlite`)
- Storybook: `pnpm storybook` (http://127.0.0.1:6006)

`drl` and `test:network` call paid APIs; the CLI loads keys itself, so never pass a dotenv file on the command line. An app's Ask calls them too, and so do a graded answer in the mock interview and Check my answer on a card. A `drl` run stops before its next paid call if HEAD or the branch changes under it, by a commit or by GitHub Desktop (ADR-0010). Voyage is on the Atlas free trial (3 requests and 10K tokens per minute): a full index takes about an hour, so run it in the background. `pnpm dev`, `pnpm dev:react`, `pnpm dev:interview` and `pnpm storybook` keep running: start them in the background and stop them when done.

## Hooks

`.claude/settings.json` runs the hooks in `tooling/claude-hooks` (ADR-0002):
- before a tool call, block anything that names a `.env*` file, and file-tool writes to `data/` or `.cache/`;
- after an edit, run lint, typecheck and depcruise for that package;
- before stopping, run tests and depcruise for packages changed since HEAD, and always the ts-docs tests, whose globals check covers every app. This also covers edits made through the shell.

When a hook reports an error, fix the cause. Never weaken the hook or the rule. The guard matches text, so do not name `.env*` files in commands or commit messages at all.

## Architecture boundaries

These are enforced by dependency-cruiser. Do not work around them.

- Apps import packages. Packages never import apps.
- `packages/sources/*` import only `@docs-rag-lab/source-kit`.
- `core` imports `source-kit`, `db` and `contracts`, never `ui`.
- `ui` is client-safe: of the internal packages it imports only `contracts`, never `core` or `db`.
- `contracts` imports nothing: no internal package, no Node.js built-in, no npm package (ADR-0006).
- `settings` imports no internal package, and `core` imports only its types (ADR-0007).
- `docs-server` imports `core`, `contracts` and `settings`, never `ui`, `db` or a source (ADR-0016).
- `interview-server` imports `core`, `contracts` and `settings`, never `ui`, `db` or a source (ADR-0018).
- Import a package only through its public `index.ts`. The one exception is `@docs-rag-lab/ui/tokens.css`, which an app's global stylesheet imports.

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
- Before committing a milestone, run the `code-reviewer` subagent.

## Never

- Read or print `.env*` files, or commit secrets.
- Write to `data/` or `.cache/` by hand. These are generated.
- Add LangChain, LlamaIndex or other RAG frameworks.
- Hardcode model IDs or prices outside `packages/settings`, or put a secret in it.
- Use em dashes in any text: docs, comments, commit messages, UI copy. Use plain hyphens.
- Change a frozen golden set without a reason from the docs text, a new set version and a changelog entry (ADR-0009, section 9). A ranking is never the reason.
- Allow an exception to that rule other than the one in ADR-0009 section 9, with all of its conditions.
