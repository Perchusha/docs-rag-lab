# Docs RAG Lab

Interview preparation and docs Q&A grounded in official technical documentation.

Docs RAG Lab is a local RAG engine over the TypeScript and React documentation. It comes with:

- docs assistants that answer with native citations to exact doc sections;
- an inspector that shows how every answer was retrieved;
- an evaluation harness that measures each retrieval technique against honest baselines;
- an interview-prep app with compiler-verified questions.

Everything runs locally. There is no deployment. The full design is in [SPEC.md](SPEC.md).

## Status

**M4 (the eval harness) is done.** Three rows of the strategy ladder are measured on a frozen golden set of 40 TypeScript questions and 5 the docs do not answer, at docs commit `205122bb`. M5 adds rerank and contextual retrieval as new rows.

| Row | Right chunk in top 8 | How high it ranks (MRR) | Fully correct, may run high | All citations hold | Cites the right passage | Wrongly refused, fewer is better | Time and cost per answer |
|---|---|---|---|---|---|---|---|
| 0, Claude without RAG | no retrieval | no retrieval | 36 of 40 (77-96%) | cannot: no docs | cannot: no docs | 1 of 40 (0-13%) | 3.9 s (3.6-4.2), $0.004 ($0.004-0.005) |
| 2, vector | 36 of 40 (77-96%) | 0.751 (0.63-0.86) | 36 of 40 (77-96%) | 38 of 40 (83-99%) | 35 of 40 (74-95%) | 1 of 40 (0-13%) | 4.2 s (3.8-4.5), $0.022 ($0.021-0.022) |
| 3, hybrid | 36 of 40 (77-96%) | 0.657 (0.55-0.76) | 34 of 40 (71-93%) | 33 of 40 (68-91%) | 36 of 40 (77-96%) | 2 of 40 (1-17%) | 4.7 s (4.2-5.2), $0.023 ($0.022-0.023) |

Each number has its 95% interval beside it: Wilson for a count, a seeded bootstrap over questions for a mean. All three rows refused all 5 questions the docs do not answer, 5 of 5 (57-100%). Time and cost are from when each answer was first made, since the final run read them from the cache.

**Correctness may run high, in every row.** An LLM judge grades the answers, and a human checks the judge on samples labelled without seeing its verdicts. The first round missed the bar on correctness, at 10 of 12. The prompt then stated the rubric outright, and a fresh blind round, under a rule fixed before it, agreed on 9 of 10 (60-98%). Refusals, at 15 of 15 (80-100%), and citations, at 8 of 8 (68-100%), keep their first-round results. The new prompt changed only 1 of 120 verdicts, so that pass reflects another sample of answers and not a better judge. All 3 disagreements across both rounds are the judge scoring higher than the human, so correctness may be slightly inflated.

What the numbers say:
- **No difference between vector and hybrid holds up.** Compared question by question with an exact sign test: on MRR vector is ahead on 14, hybrid on 7, with 19 tied, p = 0.19, not significant. On fully correct it is 2 to 0, which is noise. On all citations hold it is 5 to 0, p = 0.06, not significant, and hybrid differs from itself on 5 questions between two runs. Counted per claim, the report's verdict is vector better, 7 to 0, p = 0.016, but against hybrid's second run it is 2 to 0, and hybrid differs from itself by 1 to 5, so that is run-to-run noise and not a difference between the rows ([ADR-0012](docs/adr/0012-answer-metrics-and-the-judge.md)). Hybrid stays the default until M5.
- **On this set, Claude without docs is about as correct as RAG,** so correctness alone does not show what RAG adds. What RAG adds is grounding: most of its answers cite passages that hold. More questions whose answers changed after the models' training cutoff are a candidate for golden set v2.
- **Correct and grounded, exploratory and no target, may run high:** an answer that scores 2, has every cited claim supported and cites an anchor. It was defined after seeing results. Vector has 31 of 40 (62-88%), hybrid 28 of 40 (55-82%) and, on its second run, 32 of 40 (65-89%), so it does not separate them. Row 0 cannot score by design. Vector 5, hybrid 2, p = 0.45, not significant.
- **Three retrieval targets from M2 are unmet.** Hybrid still ranks ts-0033, ts-0027 and ts-0004 below vector search. Two fixes were tested under criteria fixed first and not adopted ([ADR-0011](docs/adr/0011-retrieval-hypotheses.md)). The reranker in M5 is the next lever.

The numbers come from [the final report](eval/reports/typescript/2026-11-03-94474c83-final.md). `drl eval verify` reproduced its retrieval byte for byte on the same vectors. On other vectors only the conclusions are promised, and the baseline's held from a clean worktree with no data ([ADR-0010](docs/adr/0010-eval-reports-and-reproducibility.md)). Answers do not repeat, so they are stored in the report. `pnpm dev` serves all of this at `/eval`, with the tables per tag, the diffs per question and a comparison of any two runs behind one button.

**M3 gave it an app.** `pnpm dev` starts a TypeScript docs assistant on http://127.0.0.1:3000:

- a streaming answer with numbered citations to the exact doc sections;
- a retrieval inspector that opens on demand, from "How was this found?" under an answer or from a citation. It shows every candidate list, the fused ranking with each list's part of the RRF score, the chunks sent to Claude, and where each chunk of a document starts and ends;
- a Hybrid/Vector toggle and "Search only" in the inspector's header, which re-run the retrieval without calling Claude.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/ts-docs-dark.png">
  <img alt="The ts-docs app: the answer to 'In which version did satisfies appear?' with a citation on the left; on the right, the inspector's fusion table, where a banner says BM25 counts twice for 6 of the top 8 chunks and each such row says BM25 x2." src="docs/images/ts-docs-light.png">
</picture>

The fusion view shows BM25 counted twice: `satisfies` is both a search term and an exact token, and the vector search's top hit falls to third. Removing that second count was tested in M4 and not adopted: it wins some questions, loses others, and reaches none of the three targets (ADR-0011). The inspector is keyboard-accessible, never shows state by colour alone, and reflows at 320 CSS px (1280 px at 400% zoom). Every ui component state is a Storybook story that runs as a test in Chromium, with axe, in light and dark.

Before M3:
- M1 synced the TypeScript docs incrementally, embedded them with Voyage through a shared cache, and answered with native citations from `drl ask`, with tokens and cost after every command.
- M2 added hybrid search (FTS5 BM25 and exact tokens fused with vector search by Reciprocal Rank Fusion), doc type filters and the retrieval trace.

The milestones are in [SPEC.md section 13](SPEC.md#13-milestones). Notes and metrics per milestone, including the first full index, are in [docs/journal.md](docs/journal.md).

Every claim about retrieval quality is backed by a measured row in the table above, and every report behind one is in [eval/reports/typescript/](eval/reports/typescript/).

## Requirements

- Node 26.13.0, the current LTS. It is pinned in `.nvmrc`, and `pnpm install` refuses anything outside `^26.13.0`.
- pnpm 12.16.1 (`npm i -g pnpm@12.16.1`). Node 26 does not bundle corepack.
- git on the PATH, for syncing doc sources.
- For the ui story tests: Playwright's headless Chromium, installed once with `pnpm --filter @docs-rag-lab/ui exec playwright install --only-shell chromium`.
- For `drl` and the app only: an Anthropic API key and a Voyage key created in MongoDB Atlas (AI Model APIs). Copy `.env.example` to `.env` and fill it in; the CLI loads it itself. Without a payment method on the Atlas org, Voyage allows 3 requests and 10K tokens per minute, so the first full index takes about an hour; the limits are in `packages/settings/src/settings.ts`.

## Quickstart

```sh
pnpm install
pnpm format:check
pnpm turbo run lint typecheck test build
```

These are the same checks CI runs, and they need no API keys. Then, with keys:

```sh
pnpm test:network                 # one tiny Voyage call and one tiny Claude call
pnpm drl sync typescript          # clone, parse, chunk and embed (incremental after the first run)
pnpm drl ask "What is the difference between unknown and any?"
pnpm dev                          # the docs assistant on http://127.0.0.1:3000
```

## Commands

| Command | What it does |
|---|---|
| `pnpm install` | Install all workspace dependencies |
| `pnpm turbo run lint typecheck test build` | Lint, typecheck, tests and the app's `next build`. Both `lint` and `test` include the dependency-cruiser boundary check. CI runs this plus `pnpm format:check` |
| `pnpm turbo run test --filter=@docs-rag-lab/core` | Tests for one package. Also works with `lint` and `typecheck` |
| `pnpm turbo run test "--filter=...[HEAD]"` | Tests for packages changed since HEAD and their dependents |
| `pnpm depcruise` | Boundary check only |
| `pnpm format` | Format with Prettier |
| `pnpm format:check` | Check Prettier formatting, then check that no file contains an em dash |
| `pnpm drl sync typescript [--full] [--at <sha>]` | Sync the TypeScript docs into `data/sources/typescript.sqlite`, at the head of the branch or at that commit (the next sync without `--at` returns to the head). Re-embeds only new or changed chunks |
| `pnpm drl ask "<question>" [--strategy vector\|hybrid] [--doc-type <type>] [--top-k <n>] [--verbose]` | Answer from the docs with numbered citations; `--verbose` prints the retrieval trace first |
| `pnpm drl search "<question>" [--strategy vector\|hybrid] [--doc-type <type>] [--json]` | Retrieval only, no Claude call: print the retrieval trace, or with `--json` the whole trace as JSON |
| `pnpm drl limits` | Show what the Voyage endpoint says about rate limits (one tiny request) |
| `pnpm drl eval [--name <name>] [--strategy vector\|hybrid]` | Retrieval metrics over the golden set, written as a report under `eval/reports/`. No Claude call. A named run is committed; without a name it goes to `dev/`, which git ignores |
| `pnpm drl eval verify <report> [--record]` | Run a report again and say whether it reproduces. `--record` writes what it found next to the report, for the dashboard |
| `pnpm drl eval compare <a> <b>` | Compare two reports question by question, and mark what is noise |
| `pnpm drl eval answers [--only <ids>] [--noise] [--name <name>] [--yes]` | Answer metrics. Spends real tokens: without `--yes` it prints the estimate and stops. Reruns pay only for what is not cached |
| `pnpm drl eval judge-check --yes` | The judge on answers whose grade is known. Spends real tokens |
| `pnpm drl eval label <report> [--after <report>]` | The sheet a human labels from, with no verdicts |
| `pnpm drl eval calibrate <report> <labels> [--after <report>] [--sample-of <report>]` | How often the labels agree with the judge. Also writes what named reports' markdown says of the judge |
| `pnpm drl eval check [--accept]` | Check the golden set against the index, with no API calls: which questions are stale, and which anchors changed since the lock |
| `pnpm test:network` | Opt-in network smoke test: one tiny embedding and one tiny Claude call. Never runs in CI |
| `pnpm dev` | The ts-docs app on http://127.0.0.1:3000, after `drl sync typescript`. Asking spends tokens; the inspector's toggle and Search only make no Claude call, and `/eval` only reads committed reports |
| `pnpm storybook` | Storybook for the ui package on http://127.0.0.1:6006, with the accessibility panel |

Every `drl` command that calls an API ends with a line of tokens used and estimated cost at list prices.

## Repository layout

| Path | Package | Purpose |
|---|---|---|
| `apps/ts-docs` | `@docs-rag-lab/ts-docs` | TypeScript docs assistant and eval dashboard: a Next.js app, its config and its routes |
| `packages/core` | `@docs-rag-lab/core` | Ingest, embeddings and the embedding cache, retrieval, generation, eval runner |
| `packages/source-kit` | `@docs-rag-lab/source-kit` | Source interface, git sync, hashing, chunker, conformance suite |
| `packages/sources/typescript` | `@docs-rag-lab/source-typescript` | TypeScript-Website parser |
| `packages/db` | `@docs-rag-lab/db` | SQLite schema, migrations, typed queries |
| `packages/contracts` | `@docs-rag-lab/contracts` | Data shapes that cross boundaries: retrieval trace, citations, answer events |
| `packages/settings` | `@docs-rag-lab/settings` | Engine settings shared by the CLI and apps: models, prices, limits |
| `packages/ui` | `@docs-rag-lab/ui` | Client components: chat, citations, the retrieval inspector, the eval dashboard, with Storybook |
| `packages/cli` | `@docs-rag-lab/cli` | The `drl` CLI |
| `packages/config` | `@docs-rag-lab/config` | Shared tsconfig, ESLint and Vitest presets; dependency-cruiser rules |
| `tooling/claude-hooks` | `@docs-rag-lab/claude-hooks` | Claude Code hooks |
| `tooling/repo-checks` | `@docs-rag-lab/repo-checks` | Repository checks (no em dashes) |
| `eval/` | | Committed reports and the human labels that check the judge |
| `docs/adr` | | Architecture decision records |

React support (`packages/sources/react`, `apps/react-docs`) arrives in M6, the interview-prep app in M8 and the MCP server in M10.

## Architecture boundaries

Enforced by dependency-cruiser on every `lint` run, locally, in CI and in the Claude Code PostToolUse hook:

- Apps import packages. Packages never import apps, and apps never import other apps.
- `sources/*` import only `source-kit`.
- `core` imports only `source-kit`, `db`, `contracts`, and types from `settings`.
- `source-kit`, `db`, `contracts` and `settings` import no internal package. `contracts` imports no npm package or Node.js built-in either.
- `ui` is client-safe: of the internal packages it imports only `contracts`, and no Node.js built-ins.
- A package is imported only through its public `src/index.ts`. The one exception is ui's `tokens.css`, which an app's global stylesheet imports.

Each rule is tested against a fixture tree of deliberate violations: [packages/config/test/dependency-cruiser.test.ts](packages/config/test/dependency-cruiser.test.ts). The reasons behind the rules are in [ADR-0002](docs/adr/0002-boundaries-and-hooks.md). The stack choices, such as TypeScript 6.0 rather than 7, are in [ADR-0001](docs/adr/0001-stack.md). Why the chunker lives in source-kit and the embedding cache in core is in [ADR-0003](docs/adr/0003-source-kit-and-core-split.md). The ingest design (chunk IDs, incremental sync, rate limits, cost reporting) is in [ADR-0004](docs/adr/0004-ingest-design.md). Hybrid retrieval and the trace are in [ADR-0005](docs/adr/0005-hybrid-retrieval-and-trace.md), the contracts package and the answer events in [ADR-0006](docs/adr/0006-contracts-package.md), the settings package in [ADR-0007](docs/adr/0007-settings-package.md), the app and ui stack (localhost binding, safe markdown, accessibility, stories as tests) in [ADR-0008](docs/adr/0008-ts-docs-app-and-ui.md), golden sets and their anchors in [ADR-0009](docs/adr/0009-golden-sets-and-anchors.md), and eval reports and what reproducible means in [ADR-0010](docs/adr/0010-eval-reports-and-reproducibility.md). How answers are graded and the judge is checked is in [ADR-0012](docs/adr/0012-answer-metrics-and-the-judge.md), and the dashboard's rules are in [ADR-0013](docs/adr/0013-eval-dashboard.md).

## How this repo is built with Claude Code

The Claude Code setup is part of the project, and it is kept small and real.

- **Instructions:**
  - [CLAUDE.md](CLAUDE.md), under 200 lines: commands, boundaries, definition of done, and the Never list;
  - nested `CLAUDE.md` files in `packages/core`, `packages/sources`, `packages/ui` and `apps`, which load when Claude works there;
  - a path-scoped rule for tests: [.claude/rules/testing.md](.claude/rules/testing.md).
- **Subagent:** [code-reviewer](.claude/agents/code-reviewer.md) does a fresh-context review against the boundaries, ADRs and tests before each milestone is committed. In M0 it found a way to launder any import through the config package; that hole is now a tested rule.
- **Hooks** ([.claude/settings.json](.claude/settings.json), code in `tooling/claude-hooks`, unit-tested):
  - **PreToolUse** blocks tool calls that name a dotenv file (case-insensitive; the committed example is allowed). It also blocks file-tool writes under `data/` and `.cache/`.
    - It matches text, so it cannot see through shell globs such as `cat .e*`.
    - The permission deny rules in the same file are a second layer.
  - **PostToolUse** runs lint, typecheck and the boundary check for the package Claude just edited. Errors go straight back to Claude. It takes about 2.7s per edit for most packages and a median of 4.5s for ui, whose type-aware React lint is the slowest (1-2s when cached).
  - **Stop** runs the tests and the boundary check for changed packages before Claude finishes, and always the ts-docs tests, whose check of the global stylesheet covers every app. For ui that includes every story in Chromium, with axe. This also covers edits made through the shell, which skip PostToolUse. It blocks once, then only warns, so it cannot loop.
- **Proof:** each hook catching a deliberate mistake, and CI failing on a boundary violation, are recorded with links in [docs/journal.md](docs/journal.md).

## License

The code is MIT, see [LICENSE](LICENSE). The indexed documentation belongs to its authors and is used under CC BY 4.0. Attribution is in [NOTICE](NOTICE).
