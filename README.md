# Docs RAG Lab

Interview preparation and docs Q&A grounded in official technical documentation.

Docs RAG Lab is a local RAG engine over the TypeScript and React documentation. It comes with:

- docs assistants that answer with native citations to exact doc sections;
- an inspector that shows how every answer was retrieved;
- an evaluation harness that measures each retrieval technique against honest baselines;
- an interview-prep app with compiler-verified questions.

Everything runs locally. There is no deployment. The full design is in [SPEC.md](SPEC.md).

## Status

**M2 (hybrid search and the retrieval trace) is done.** On top of M1 (incremental sync of the TypeScript docs, Voyage embeddings through a shared cache, vector search, `drl ask` with native citations, tokens and cost after every command), it adds:

- keyword search: SQLite FTS5 with the trigram tokenizer, so `TS2345`-style tokens and parts of option names match;
- hybrid ranking: vector, keyword and exact-token lists fused with Reciprocal Rank Fusion;
- doc type filters inside the vector and keyword queries;
- a retrieval trace with every candidate list, the fused ranking, the final context and timings: `drl ask --verbose` and `drl search`;
- a parser version in the index, so a parser change re-parses without `--full`.

M3 adds the ts-docs app with the inspector. The milestones are in [SPEC.md section 13](SPEC.md#13-milestones). Notes and metrics per milestone, including the first full index, are in [docs/journal.md](docs/journal.md).

Every claim about retrieval quality will be backed by a measured row in a results table here. No measurements exist yet; the first rows arrive with the eval harness in M4.

## Requirements

- Node 26.13.0, the current LTS. It is pinned in `.nvmrc`, and `pnpm install` refuses anything outside `^26.13.0`.
- pnpm 12.16.1 (`npm i -g pnpm@12.16.1`). Node 26 does not bundle corepack.
- git on the PATH, for syncing doc sources.
- For `drl` only: an Anthropic API key and a Voyage key created in MongoDB Atlas (AI Model APIs). Copy `.env.example` to `.env` and fill it in; the CLI loads it itself. Without a payment method on the Atlas org, Voyage allows 3 requests and 10K tokens per minute, so the first full index takes about an hour; the limits are in `packages/cli/src/drl.config.ts`.

## Quickstart

```sh
pnpm install
pnpm format:check
pnpm turbo run lint typecheck test
```

These are the same checks CI runs, and they need no API keys. Then, with keys:

```sh
pnpm test:network                 # one tiny Voyage call and one tiny Claude call
pnpm drl sync typescript          # clone, parse, chunk and embed (incremental after the first run)
pnpm drl ask "What is the difference between unknown and any?"
```

## Commands

| Command | What it does |
|---|---|
| `pnpm install` | Install all workspace dependencies |
| `pnpm turbo run lint typecheck test` | Lint, typecheck and tests. Both `lint` and `test` include the dependency-cruiser boundary check. CI runs this plus `pnpm format:check` |
| `pnpm turbo run test --filter=@docs-rag-lab/core` | Tests for one package. Also works with `lint` and `typecheck` |
| `pnpm turbo run test "--filter=...[HEAD]"` | Tests for packages changed since HEAD and their dependents |
| `pnpm depcruise` | Boundary check only |
| `pnpm format` | Format with Prettier |
| `pnpm format:check` | Check Prettier formatting, then check that no file contains an em dash |
| `pnpm drl sync typescript [--full]` | Sync the TypeScript docs into `data/sources/typescript.sqlite`. Re-embeds only new or changed chunks |
| `pnpm drl ask "<question>" [--strategy vector|hybrid] [--doc-type <type>] [--top-k <n>] [--verbose]` | Answer from the docs with numbered citations; `--verbose` prints the retrieval trace first |
| `pnpm drl search "<question>" [--strategy vector|hybrid] [--doc-type <type>] [--json]` | Retrieval only, no Claude call: print the retrieval trace, or with `--json` the whole trace as JSON |
| `pnpm drl limits` | Show what the Voyage endpoint says about rate limits (one tiny request) |
| `pnpm test:network` | Opt-in network smoke test: one tiny embedding and one tiny Claude call. Never runs in CI |

Every `drl` command that calls an API ends with a line of tokens used and estimated cost at list prices.

## Repository layout

| Path | Package | Purpose |
|---|---|---|
| `apps/ts-docs` | `@docs-rag-lab/ts-docs` | TypeScript docs assistant (Next.js from M3) |
| `packages/core` | `@docs-rag-lab/core` | Ingest, embeddings and the embedding cache, retrieval, generation, eval runner |
| `packages/source-kit` | `@docs-rag-lab/source-kit` | Source interface, git sync, hashing, chunker, conformance suite |
| `packages/sources/typescript` | `@docs-rag-lab/source-typescript` | TypeScript-Website parser |
| `packages/db` | `@docs-rag-lab/db` | SQLite schema, migrations, typed queries |
| `packages/ui` | `@docs-rag-lab/ui` | Client components: chat, citations, inspector |
| `packages/cli` | `@docs-rag-lab/cli` | The `drl` CLI |
| `packages/config` | `@docs-rag-lab/config` | Shared tsconfig, ESLint and Vitest presets; dependency-cruiser rules |
| `tooling/claude-hooks` | `@docs-rag-lab/claude-hooks` | Claude Code hooks |
| `tooling/repo-checks` | `@docs-rag-lab/repo-checks` | Repository checks (no em dashes) |
| `docs/adr` | | Architecture decision records |

React support (`packages/sources/react`, `apps/react-docs`) arrives in M6, the interview-prep app in M8 and the MCP server in M10.

## Architecture boundaries

Enforced by dependency-cruiser on every `lint` run, locally, in CI and in the Claude Code PostToolUse hook:

- Apps import packages. Packages never import apps, and apps never import other apps.
- `sources/*` import only `source-kit`.
- `core` imports only `source-kit` and `db`.
- `source-kit` and `db` import no internal package.
- `ui` is client-safe: it imports no internal package, not even types, and no Node.js built-ins.
- A package is imported only through its public `src/index.ts`.

Each rule is tested against a fixture tree of deliberate violations: [packages/config/test/dependency-cruiser.test.ts](packages/config/test/dependency-cruiser.test.ts). The reasons behind the rules are in [ADR-0002](docs/adr/0002-boundaries-and-hooks.md). The stack choices, such as TypeScript 6.0 rather than 7, are in [ADR-0001](docs/adr/0001-stack.md). Why the chunker lives in source-kit and the embedding cache in core is in [ADR-0003](docs/adr/0003-source-kit-and-core-split.md). The ingest design (chunk IDs, incremental sync, rate limits, cost reporting) is in [ADR-0004](docs/adr/0004-ingest-design.md).

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
  - **PostToolUse** runs lint, typecheck and the boundary check for the package Claude just edited. Errors go straight back to Claude. It takes about 2.7s per edit with the M1 code (1.0s when cached).
  - **Stop** runs the tests and the boundary check for changed packages before Claude finishes. This also covers edits made through the shell, which skip PostToolUse. It blocks once, then only warns, so it cannot loop.
- **Proof:** each hook catching a deliberate mistake, and CI failing on a boundary violation, are recorded with links in [docs/journal.md](docs/journal.md).

## License

The code is MIT, see [LICENSE](LICENSE). The indexed documentation belongs to its authors and is used under CC BY 4.0. Attribution is in [NOTICE](NOTICE).
