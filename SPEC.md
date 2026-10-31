# Docs RAG Lab - Project Spec

> Repository: `docs-rag-lab`.

## 1. Pitch

Interview preparation and docs Q&A grounded in official technical documentation.

Docs RAG Lab is a pluggable RAG engine for technical docs (TypeScript and React first). It comes with:
- an **inspector** that shows how every answer was retrieved;
- an **evaluation harness** that measures every retrieval technique against honest baselines;
- an **interview-prep app** with compiler-verified questions.

Everything runs locally. There is no deployment.

## 2. Goals and non-goals

**Goals**
- Portfolio project that demonstrates:
  - RAG: hybrid search, reranking, contextual retrieval, agentic retrieval;
  - evaluation;
  - data engineering on real doc formats;
  - monorepo architecture;
  - a polished frontend;
  - agentic development with Claude Code.
- Personally useful: preparing for senior frontend / full-stack interviews.
- Every claim about quality is backed by numbers in the README.

**Non-goals**
- No deployment. Everything runs with `pnpm dev`, API keys in `.env`.
- No LangChain, LlamaIndex or other RAG frameworks. The pipeline is written by hand so every step is visible and explainable.
- No multi-user features, no auth.
- Not competing with Context7 (docs for coding agents). The MCP server is a bonus milestone, not the core.

## 3. Main scenarios

1. **Docs assistant.** Ask a question about TypeScript or React and get an answer with native citations to exact doc sections.
2. **Inspector.** For any answer, see:
   - the query;
   - candidates from vector and keyword search with scores;
   - the fused ranking and what the reranker changed;
   - chunk boundaries inside the source document;
   - the final context sent to Claude.
3. **Eval dashboard.** Runs per source and per strategy, metrics, diffs between runs, and stale questions after a docs sync.
4. **Interview prep.** Pick technologies and a level, then:
   - get a topic map built from the docs themselves;
   - train in different modes (see section 11);
   - track progress with spaced repetition.

## 4. Architecture

Monorepo with pnpm workspaces and Turborepo. TypeScript strict everywhere.

```
apps/
  ts-docs/          docs assistant for TypeScript (thin: config, theme, example questions)
  react-docs/       docs assistant for React (created in M6)
  interview-prep/   multi-source interview trainer (created in M8)
packages/
  core/             ingest, contextualization, embeddings and the embedding cache, hybrid search, rerank, generation, eval runner
  source-kit/       Source interface, git sync, hashing, chunker, conformance test suite (ADR-0003)
  sources/
    typescript/     TypeScript-Website parser (twoslash)
    react/          react.dev parser (MDX components; created in M6 with turbo gen)
  db/               SQLite schema, migrations, typed queries
  ui/               chat, citations, inspector, eval dashboard, topic map (with Storybook)
  cli/              drl sync | ask | eval | questions
  mcp/              MCP server over core (created in M10)
  config/           shared tsconfig, eslint, vitest presets, dependency-cruiser rules
tooling/
  claude-hooks/     Claude Code hooks: PreToolUse guard, PostToolUse checks, Stop tests (ADR-0002)
  repo-checks/      repository checks run by format:check (no em dashes)
  generators/       turbo gen templates: new source, new app (added before M6)
docs/adr/           architecture decision records
docs/journal.md     short notes per milestone with before/after metrics
```

**Package scope.** Every package is published in the workspace as `@docs-rag-lab/<name>`, for example `@docs-rag-lab/core` and `@docs-rag-lab/source-kit`. Sources are named `@docs-rag-lab/source-<id>`, for example `@docs-rag-lab/source-typescript`. Internal packages have no build step: each one exports its `src/index.ts`, and Next.js, Vitest and Node consume the TypeScript source directly (ADR-0001).

**Dependency rules.** These are enforced by dependency-cruiser in CI and in Claude Code hooks.
- Apps import packages. Packages never import apps.
- `sources/*` import only `source-kit` (no core, no db, no ui).
- `core` imports `source-kit` and `db`, never `ui`.
- `ui` is client-safe: no imports from `core` or `db`. It talks to app route handlers.
- A package is imported only through its public `index.ts`, never through internals.

The full rule set, including the rules added on top of these (for example `db` is a leaf and apps never import other apps), is in `packages/config/dependency-cruiser.cjs` and explained in ADR-0002.

**One config file per app.** Packages may not import apps, so the `drl` CLI keeps its own config with the same kind of values in `packages/cli/src/drl.config.ts` (ADR-0004).
```ts
// apps/ts-docs/rag.config.ts
export default defineDocsApp({
  id: 'ts-docs',
  sources: [typescriptSource({ branch: 'v2' })],
  retrieval: { strategy: 'hybrid', rerank: true, contextual: true, topK: 8 },
  models: {
    answer: 'claude-sonnet-5-5',
    contextualize: 'claude-haiku-5-5',
    judge: 'claude-sonnet-5-5',
  },
  embeddings: { provider: 'voyage', model: 'voyage-4' },
  theme: { accent: '#3178c6' },
  examples: ['What does error TS2345 mean?', 'In which version did `satisfies` appear?'],
})
```

**Storage layout:**
- The index belongs to the source, not to the app: `data/sources/<source-id>.sqlite`. Apps open the source indexes they need, so `interview-prep` reads the TS and React indexes without duplicating them.
- App-specific state lives in its own file, for example `data/apps/interview-prep.sqlite` (progress, sessions).
- The embedding cache is shared: `data/cache.sqlite`.
- `data/` and `.cache/` are gitignored.

## 5. Tech stack

- **Runtime and tooling:** current Node LTS, pnpm, Turborepo, TypeScript strict, ESM, Vitest, ESLint, Prettier, dependency-cruiser, Storybook. Exact versions and the reasons for them (for example TypeScript 6.0 rather than 7) are in ADR-0001.
- **Apps:** Next.js App Router with streaming route handlers.
- **LLM:** Claude through the official `@anthropic-ai/sdk`, used directly (no third-party wrapper) so `search_result` blocks and citations are available.
  - Haiku: contextualization and question generation (cheap, with prompt caching).
  - Sonnet: answers, the interviewer, the judge.
  - Model IDs live in config only.
- **Storage:** SQLite through `better-sqlite3`, with `sqlite-vec` for vectors and FTS5 for keyword search (BM25). One file per source.
- **Embeddings and reranking:** Voyage AI. Default embedding model `voyage-4`, reranker `rerank-3`.
  - The API key is created in MongoDB Atlas (AI Model APIs). The endpoint is `https://ai.mongodb.com/v1`.
  - The official TS client is `voyageai`. Set its `environment` option to the Atlas endpoint.
  - Verified against the MongoDB Atlas docs in M1. Without a payment method the key is on the free trial: 3 requests and 10K tokens per minute (ADR-0004).
- **Doc parsing:** unified / remark (`remark-mdx`, mdast) for markdown and MDX. The `twoslash` npm package compiles TS examples at ingest.
- **Spaced repetition:** an FSRS implementation, for example `ts-fsrs`.

## 6. Data model

**Per-source database:**

| Table | Contents |
|---|---|
| `manifest` | source_id, repo, branch, include_paths (json), commit_sha, synced_at, embed_model, embed_dimensions, context_model, chunker_version |
| `documents` | id, path, url, title, doc_type, content_hash, last_changed_sha |
| `chunks` | pk, id, doc_id, ordinal, heading_path, anchor, block_types (json), text, context, metadata (json), token_count, text_hash |
| `chunks_fts` | FTS5 virtual table over heading_path, context, text |
| `chunks_vec` | sqlite-vec `vec0` virtual table with cosine distance: rowid = chunks.pk, embedding |
| `eval_runs` | id, commit_sha, strategy (json), models (json), created_at, metrics (json) |
| `eval_results` | run_id, question_id, retrieved_ids (json), answer, scores (json), trace (json) |
| `questions` | id, chunk_id, type, prompt, answer, verified_by (compiler, judge or human), commit_sha, status (active or stale) |

Notes on the chunk columns:
- `pk` is an explicit integer key, so VACUUM never renumbers it; it is the chunk's rowid in `chunks_vec`. `id` is the stable chunk ID.
- `context` is the contextual retrieval prefix.
- `metadata` holds things like version_introduced, error_codes and option names, plus `spans`, the character ranges of the rendered blocks in `text`.

`manifest.include_paths`, `embed_model` (provider, model and dimensions) and `chunker_version` decide when a sync must rebuild everything (ADR-0004).

**Shared embedding cache:** key = sha256(provider id + input_type + text), where the provider id names the model and dimensions, for example `voyage:voyage-4:1024`; value = vector. It lives in `data/cache.sqlite` and is used by core (ADR-0003).

**App database (interview-prep):** progress (question_id, FSRS state, due), sessions, answers.

**Chunk IDs must be stable across syncs.** Derive the ID from doc path + heading path + ordinal within the section. `text_hash` decides whether a chunk needs re-contextualizing and re-embedding.

## 7. Source plugin contract

```ts
export interface Source {
  id: string                 // 'typescript'
  repo: string               // 'https://github.com/microsoft/TypeScript-Website'
  branch: string             // 'v2'
  include: string[]          // sparse-checkout paths
  license: { name: string; url: string; attribution: string }
  match(path: string): boolean
  parse(file: SourceFile, ctx: ParseContext): Promise<ParsedDoc>
}

export type DocType = 'handbook' | 'reference' | 'option' | 'release-notes' | 'other'

export interface ParsedDoc {
  title: string
  url: string                // canonical public URL used in citations
  docType: DocType           // shared across sources, for filters and eval breakdowns
  sections: Section[]
  metadata: Record<string, unknown>
}

export interface Section {
  headingPath: string[]
  anchor: string
  blocks: Block[]
}

export type Block =
  | { kind: 'prose'; text: string }
  | { kind: 'code'; lang: string; code: string; compiled?: CompilerOutput }
  | { kind: 'callout'; variant: string; blocks: Block[] } // Pitfall, DeepDive, Note...
```

Sync, diffing, hashing and chunking live in `source-kit`, and the embedding cache in `core` (ADR-0003), never in individual sources. A source only knows how to parse its own format. The `compiled` field of code blocks arrives with the twoslash compile in M7.

**Conformance suite.** Every source must pass `runSourceConformance(source, fixtures)`. It returns a list of failures (empty when the source passes):
- parses every fixture without throwing;
- produces absolute URLs that match the expected pattern, and a known `docType`;
- produces the same chunk IDs on two parses;
- produces no empty chunks;
- preserves code blocks byte-for-byte.

## 8. Initial sources

Measured on 2026-10-31:
- React learn + reference: about 183 files, about 3.2 MB of markdown.
- TypeScript, the indexed set below: 248 files, 1.85 MB (from the GitHub tree at `205122bb`).

That is roughly 0.8M and 0.5M tokens (TypeScript: about 506K estimated tokens in 994 chunks), well above the ~200k-token size where Anthropic suggests putting a whole knowledge base in the prompt instead of using RAG.

Attribution goes in a NOTICE file and in the UI footer, with links to sources.

### TypeScript
- **Repo and license:** `microsoft/TypeScript-Website`, branch `v2`. Docs content is CC BY 4.0, code is MIT (see the repo README).
- **Paths** (markdown files and bytes at `205122bb`; `docType` in the last column):

  | Path (`packages/documentation/copy/en/` unless noted) | Files | Bytes | docType |
  |---|---|---|---|
  | `handbook-v2/` | 18 | 255,575 | handbook |
  | `reference/` | 15 | 198,362 | reference |
  | `modules-reference/` (without `diagrams/`, which holds mermaid sources) | 5 | 153,803 | reference |
  | `declaration-files/` | 15 | 74,944 | other |
  | `project-config/` | 6 | 106,483 | other |
  | `javascript/` | 4 | 36,316 | other |
  | `release-notes/`, one file per version from 1.1 to 6.0 | 48 | 888,106 | release-notes |
  | `packages/tsconfig-reference/copy/en/options/`, one file per compiler option | 137 | 134,065 | option |
  | **Total** | **248** | **1,847,654** | |

  Release notes are 48% of the bytes. Not indexed: `handbook-v1/`, `tutorials/`, `get-started/` and `Nightly Builds.md`.
- **URLs:** documentation frontmatter has `title`, `permalink` and `oneline`; URLs are `https://www.typescriptlang.org` + `permalink` (file names do not match URLs). Option files have only `display` and `oneline`. Each option has its own case-sensitive page, `https://www.typescriptlang.org/tsconfig/<name>.html`, except the `typeAcquisition/` options, which live at `https://www.typescriptlang.org/tsconfig/#type-<name>`. Heading anchors follow github-slugger. All verified on the live site.
- **Markup:** about 10 upstream files use CRLF line endings. Raw HTML appears (background-reading boxes, `<details>`, the 282-row tsc options table); HTML comments hide whole sections in `TypeScript 5.0.md`, which the site does not render.
- **Code examples:** fences look like ```` ```ts twoslash ```` with directives such as `// @errors: 2345` and `// ^?`. In M7, compile them at ingest with twoslash and inline the real compiler errors and inferred types into the chunk text. Keep the structured compiler output in metadata for interview questions.
- **Metadata:**
  - the release-notes version becomes `version_introduced`;
  - error codes from `@errors` are stored for exact-match search.

### React
- **Repo and license:** `reactjs/react.dev`, branch `main`. Content is CC BY 4.0 (`LICENSE-DOCS.md`).
- **Paths:** `src/content/learn/` and `src/content/reference/`.
- **MDX components:** `useState.md` uses `<Sandpack>`, `<Solution>`, `<Recipes>`, `<Pitfall>`, `<Intro>`, `<InlineToc>` and `<DeepDive>`. Survey all components in M6.
  - Keep code from `<Sandpack>` as code blocks.
  - Keep `<Pitfall>`, `<DeepDive>` and `<Note>` as `callout` blocks with a variant.
  - Drop pure layout components.
- **URLs:** the path maps to `https://react.dev/<section>/<slug>`.

## 9. Pipeline

### Sync (`drl sync <source>`)
1. Shallow, sparse, blob-less clone, or fetch, into `.cache/sources/<id>`, with `core.autocrlf=false`. Files are read with LF line endings.
2. Find changes:
   - if the manifest has a previous SHA, run `git diff --name-status -z --no-renames <old> <new> -- <include paths>`, fetching the old commit by SHA if the shallow clone lacks it;
   - otherwise, or if the old commit is unreachable, or the chunker version, embedding model, repository, branch or include paths changed, do a full build. A full build still compares chunk hashes, so unchanged text costs nothing.
3. Apply changes:
   - deleted files: remove their documents and chunks;
   - added or modified files: parse, chunk, and compare chunk hashes.
4. Only new or changed chunks go through contextualization and embedding. Everything else comes from the cache. Embedding requests are batched and kept under the provider's rate limits (ADR-0004).
5. Update FTS and vector tables in one transaction, then write the manifest.
6. Mark eval questions and question-bank items whose anchor chunks changed or disappeared as `stale` (from M4, when those tables exist).

Every `drl` command that calls an API ends with the tokens it used and their estimated cost at list prices.

### Chunking
- Split by the heading tree, up to 800 estimated tokens of blocks per chunk; the heading-path prefix line comes on top. A subtree that fits is one chunk; one that does not is packed into balanced chunks, section by section (ADR-0004).
- Never split a code block.
- Keep the heading path as a prefix.
- `chunker_version` is stored in the manifest. Bumping it forces a rebuild.

### Contextual Retrieval
- For each chunk, Haiku writes 1-3 sentences that situate the chunk in its document (Anthropic's Contextual Retrieval technique).
- The document is sent once with prompt caching and reused for all its chunks.
- The context is prepended for both embedding and FTS. It is stored separately so the inspector can show it and eval can toggle it.

### Retrieval
1. Vector search top 50 plus FTS5 BM25 top 50.
2. Reciprocal Rank Fusion.
3. `rerank-3` over the top 20.
4. Top K (default 8) goes to generation.

Filters: source, version, block type.

Every retrieval returns a **trace object**: all candidate lists with scores, plus timings. The inspector renders it and eval results store it.

### Generation
- Sonnet receives the retrieved chunks as `search_result` content blocks with citations enabled:
  - `source` = canonical doc URL with anchor;
  - `title` = doc title + heading path;
  - `content` = text blocks, one per rendered block of the chunk, so citations point at precise passages.
- The response is streamed, and citations are rendered inline in the UI.
- The system prompt says: answer only from the provided results, and say so when they are not enough.

### Agentic mode
- Claude gets a `search_docs` tool (query + filters). The tool returns `search_result` blocks in its tool results.
- Claude may search several times, up to a configurable maximum number of steps.
- Agentic mode is compared against single-shot retrieval in eval.

## 10. Evaluation

**Golden sets.** One file per source: `packages/sources/<id>/eval/questions.jsonl`, for example:
```json
{"id":"ts-0001","question":"...","answer":"...","anchors":["handbook-v2/Everyday Types.md#union-types"],"tags":["basic"]}
```
- Tags: `basic`, `version`, `edge`, `fresh`, `exact-token`.
- Start with 40 questions per source, written or reviewed by a human. Claude may draft candidates with the `write-eval-questions` skill. A human approves every question.

**Metrics:**
- retrieval recall@5 and recall@10 (is the anchor chunk among the retrieved ones?);
- MRR;
- answer correctness: a Claude judge scores 0-2 against a rubric;
- citation accuracy: do the cited sources include the anchor?
- latency;
- tokens and cost per question.

**Strategy ladder.** Each strategy is one row of the README table:
0. Claude without RAG
1. Long context: the whole corpus in the prompt. Only for a small subset (for example the tsconfig reference), to show where the line is.
2. Vector only
3. Hybrid (vector + BM25, RRF)
4. Hybrid + rerank
5. Hybrid + rerank + contextual retrieval
6. Agentic

**Reports:** `eval/reports/<source>/<date>-<sha>.md` plus JSON. The dashboard reads the JSON. Every report records the docs commit SHA and the models used, so results are reproducible.

**Judge calibration:** in each milestone that touches eval, spot-check 20 judgments by hand and record the agreement rate.

## 11. Interview-prep app

**Setup:**
- Choose technologies from the available sources, plus a level (middle or senior).
- Later: paste a job description, and Claude extracts technologies and topics.

**Topic map:** built from the corpus structure (handbook chapters, react.dev learn and reference sections). A heatmap shows progress per topic.

**Modes:**
1. **Compiler-verified questions (TS).** Generated from twoslash examples: "what type is inferred here?", "which error does this produce?". The correct answer comes from compiler output stored at ingest, not from the LLM.
2. **"What is wrong with this code?" (React).** Generated from `<Pitfall>` blocks.
3. **Flashcards.** Short question and answer, with the citation on the back.
4. **Mock interview.** An agent (Sonnet) with the tools `search_docs`, `get_progress` and `record_score`:
   - asks open questions by topic and level;
   - grades answers against the retrieved docs;
   - gives feedback with citations;
   - asks follow-up questions.
5. **Later:** "30-second answer vs deep dive" coaching, voice mode.

**Question bank:**
- Generated offline per chunk (Haiku) and versioned with the docs SHA.
- On sync, regenerated only for chunks that changed.
- A judge checks every generated question: can it be answered from its anchor chunk? Rejected questions are dropped.
- After human approval, a question can be promoted to the eval golden set.

**Progress:**
- FSRS spaced repetition in local SQLite.
- After a mock interview: weak topics plus 3 sections to read.

**MVP scope:** technology selection, compiler-verified TS questions, React Pitfall questions, a text mock interview, basic progress.

## 12. Agentic development setup (Claude Code)

This setup is part of the showcase. Keep it real and minimal.

- **Root `CLAUDE.md`, under 200 lines:** overview, commands, boundaries, definition of done, pointers to SPEC.md and ADRs.
- **Nested `CLAUDE.md` files** in `packages/core`, `packages/sources`, `packages/ui` and `apps/`. They load on demand when Claude works in those folders.
- **Path-scoped rules** in `.claude/rules/`. Example: for `**/*.test.ts`, no network and use fixtures.
- **Skills** in `.claude/skills/<name>/SKILL.md`:
  - `add-source`, user-invoked only (`disable-model-invocation: true`):
    1. scaffold with `turbo gen source`;
    2. implement the parser against fixtures;
    3. pass the conformance suite;
    4. add 20 eval questions;
    5. run eval;
    6. update the README table.
  - `run-eval`: run eval for a source and strategy, compare with the last report, flag regressions, write a summary.
  - `write-eval-questions`: draft candidate golden questions with anchors for human review.
- **Subagents** in `.claude/agents/`:
  - `code-reviewer`: a fresh-context review against the boundaries, ADRs and tests;
  - `eval-analyst`: classifies failures as retrieval miss, generation error or bad question.
- **Hooks** in `.claude/settings.json` (committed):
  - PostToolUse on `Edit|Write`: typecheck, lint and dependency-cruiser for the touched package. Exit with code 2 on failure so the error goes back to Claude and Claude fixes it.
  - Stop: `turbo run test --filter=...[HEAD]` (tests for affected packages only).
  - PreToolUse: block reading `.env*` and writing to `data/**` and `.cache/**`.
  - Add the hooks in M0 only after the commands exist and pass on the empty scaffold. Prove each hook works.
- **`.mcp.json` (M10):** the project's own MCP server, so Claude Code can query TS and React docs through Docs RAG Lab while building Docs RAG Lab (dogfooding).
- **README section "How this repo is built with Claude Code":** an overview of the setup, plus links to real PRs (for example, a source added via `/add-source`, or a hook catching a mistake).

## 13. Milestones

Every milestone ends with:
- small PRs and green CI;
- an updated README;
- an entry in `docs/journal.md` with before/after metrics. Each entry should be post-worthy, since it becomes a LinkedIn post.

| # | Milestone | Scope | Acceptance |
|---|---|---|---|
| M0 | Scaffold | Monorepo, tooling, GitHub Actions CI (lint, typecheck, test), root and nested CLAUDE.md, `.env.example`, MIT LICENSE + NOTICE, ADR-0001 (stack), then hooks | `pnpm i && pnpm turbo run lint typecheck test` is green. A deliberate boundary violation fails both CI and the hook |
| M1 | TS ingest + CLI | `source-kit` sync, TS parser (no twoslash compile yet), chunker, Voyage embeddings with cache, vector search, `drl ask` with `search_result` citations | Conformance suite passes. A test proves incremental sync re-embeds only changed chunks |
| M2 | Hybrid + trace | FTS5, RRF, retrieval trace object | Trace has every candidate list with scores |
| M3 | ts-docs app | Streaming chat with citations, inspector panel, Storybook for `ui` | Inspector shows candidates, scores and chunk boundaries |
| M4 | Eval harness | 40 TS questions, metrics, ladder rows 0, 2 and 3, reports, dashboard view | Report is reproducible from SHA + config |
| M5 | Rerank + contextual | Ladder rows 4 and 5, prompt caching, cost tracking | README table has measured rows |
| M6 | React via `/add-source` | `react-docs` app, 40 questions | Done through the skill; the PR links the session |
| M7 | Twoslash compile | Compiler output inlined, exact-token metadata | `exact-token` questions improve and are measured |
| M8 | Interview-prep MVP | Scope from section 11 | You use it yourself for a real interview |
| M9 | Agentic mode | Ladder row 6 | Compared against single-shot |
| M10 | MCP + more sources | Docs RAG Lab MCP server, dogfooding via `.mcp.json`. Optional: Rust Book (MIT/Apache), Python docs (PSF-2.0, examples also 0BSD) | Claude Code uses Docs RAG Lab while working on Docs RAG Lab |

## 14. Conventions

- TypeScript strict and ESM. No `any` without an explaining comment.
- No RAG frameworks.
- Unit tests never hit the network: fixtures live in `__fixtures__`. Network tests are tagged and opt-in.
- Secrets only come from `.env` (`ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`). `.env.example` is committed.
- Model IDs and prices live in config only.
- Conventional commits. Every non-obvious decision gets an ADR: `docs/adr/NNNN-title.md`.
- Generated data (`data/`, `.cache/`) is gitignored. Eval reports are committed.
- Writing style in docs and comments: never use em dashes, use plain hyphens.

**Costs:**
- The Anthropic API is billed separately from a Claude subscription.
- Voyage is billed per token.
- Contextualization runs once per chunk and is cached. Re-syncs only pay for changed chunks.

## 15. Open decisions

- Commit the generated question bank, or regenerate it locally?
- Voice mode in interview prep: browser speech API, or skip it.
- More sources before or after the interview-prep MVP?

## 16. References

- Claude search results (citations for RAG): https://platform.claude.com/docs/en/build-with-claude/search-results
- Claude citations: https://platform.claude.com/docs/en/build-with-claude/citations
- Claude prompt caching: https://platform.claude.com/docs/en/build-with-claude/prompt-caching
- Embeddings (Voyage via MongoDB Atlas): https://platform.claude.com/docs/en/build-with-claude/embeddings
- Anthropic Contextual Retrieval: https://www.anthropic.com/news/contextual-retrieval
- Claude Code memory (CLAUDE.md, rules): https://code.claude.com/docs/en/memory
- Claude Code skills: https://code.claude.com/docs/en/skills
- Claude Code hooks: https://code.claude.com/docs/en/hooks-guide
- Claude Code subagents: https://code.claude.com/docs/en/sub-agents
- TypeScript-Website: https://github.com/microsoft/TypeScript-Website
- react.dev: https://github.com/reactjs/react.dev
