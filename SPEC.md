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
- Not competing with Context7 (docs for coding agents). The MCP server comes later, after v1.0, and is not the core.

## 3. Main scenarios

1. **Docs assistant.** Ask a question about TypeScript or React and get an answer with native citations to exact doc sections.
2. **Inspector.** For any answer, see:
   - the query;
   - candidates from vector and keyword search with scores;
   - the fused ranking and, on demand, what the reranker would change (ADR-0014: the chat stays on hybrid);
   - chunk boundaries inside the source document;
   - the final context sent to Claude.
3. **Eval dashboard.** Its first screen answers three questions: does hybrid find the right chunks more often, does it give better answers and does RAG help at all, and can these numbers be trusted. A report with the reranker's rows asks instead whether rerank finds the right chunks higher, whether that reaches the answers, and the same third question. Per-tag tables, per-question diffs, cited chunks and diffs between runs sit behind one disclosure. Every number has its uncertainty beside it, and the dashboard only reads committed reports (ADR-0013).
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
  contracts/        data shapes that cross boundaries: the retrieval trace, citations, the answer stream (ADR-0006)
  settings/         engine settings shared by the CLI and apps: models, prices, limits, retrieval defaults (ADR-0007)
  ui/               chat, citations, inspector, eval dashboard, topic map (with Storybook)
  docs-server/      route handlers and the engine's one instance, shared by the docs apps (created in M6, ADR-0016)
  interview-server/ route handlers and the backend of the interview-prep app (created in M8, ADR-0018)
  cli/              drl sync | ask | eval | questions
  mcp/              MCP server over core (later, after v1.0)
  config/           shared tsconfig, eslint, vitest presets, dependency-cruiser rules
tooling/
  claude-hooks/     Claude Code hooks: PreToolUse guard, PostToolUse checks, Stop tests (ADR-0002)
  repo-checks/      repository checks run by format:check (no em dashes)
  generators/       turbo gen template for a new source (added in M6; none for a new app, ADR-0016)
docs/adr/           architecture decision records
docs/journal.md     short notes per milestone with before/after metrics
```

**Package scope.** Every package is published in the workspace as `@docs-rag-lab/<name>`, for example `@docs-rag-lab/core` and `@docs-rag-lab/source-kit`. Sources are named `@docs-rag-lab/source-<id>`, for example `@docs-rag-lab/source-typescript`. Internal packages have no build step: each one exports its `src/index.ts`, and Next.js, Vitest and Node consume the TypeScript source directly (ADR-0001).

**Dependency rules.** These are enforced by dependency-cruiser in CI and in Claude Code hooks.
- Apps import packages. Packages never import apps.
- `sources/*` import only `source-kit` (no core, no db, no ui).
- `core` imports `source-kit`, `db` and `contracts`, never `ui`.
- `ui` is client-safe: of the internal packages it imports only `contracts`, never `core` or `db`. It talks to app route handlers.
- `contracts` imports nothing: no internal package, no Node.js built-in, no npm package. It holds the shapes that core produces and ui renders (ADR-0006).
- `settings` imports no internal package, and `core` imports only its types (ADR-0007).
- `docs-server` imports `core`, `contracts` and `settings`, never `ui`, `db` or a concrete source. An app builds its source and passes it in (ADR-0016).
- `interview-server` imports `core`, `contracts` and `settings`, never `ui`, `db` or a concrete source. The interview-prep app builds its sources and passes them in (ADR-0018).
- A package is imported only through its public `index.ts`, never through internals.

The full rule set, including the rules added on top of these (for example `db` is a leaf and apps never import other apps), is in `packages/config/dependency-cruiser.cjs` and explained in ADR-0002.

**Settings and app config.** Engine settings live in one place, `packages/settings/src/settings.ts`: data dirs, source options, the embedding provider and its limits, model IDs, answer effort, retrieval defaults and prices. They are plain data with no secrets, so they can be written into traces and reports; the provider constructors in core read API keys from the environment (ADR-0007). The CLI and every app import the same object. An app's own config holds only what belongs to the app:
```ts
// apps/ts-docs/rag.config.ts
import { defineDocsApp } from '@docs-rag-lab/ui'

export default defineDocsApp({
  id: 'ts-docs',
  source: 'typescript',
  title: 'TypeScript docs assistant',
  // One shade per colour scheme: each must reach 4.5:1 on its background (ADR-0008).
  theme: { accent: { light: '#235a97', dark: '#79b8ff' } },
  examples: ['What does error TS2345 mean?', 'In which version did `satisfies` appear?'],
})
```

An app itself is a page and one-line routes over the handlers in `docs-server`: `POST /api/ask` (the answer as an NDJSON stream of events), `POST /api/search` (the trace, no Claude call) and `GET /api/documents` (a document's chunks in order), and the dashboard's under `/api/eval`. It listens on 127.0.0.1 only (ADR-0008): `ts-docs` on port 3000 and `react-docs` on 3001. The interview-prep app is a page and one-line routes over the handlers in `interview-server`, `GET /api/interview/overview`, `GET /api/interview/deck` and `POST /api/interview/review`, none of which calls a model, on port 3002 (ADR-0018).

**Storage layout:**
- The index belongs to the source, not to the app: `data/sources/<source-id>.sqlite`. Apps open the source indexes they need, so `interview-prep` reads the TS and React indexes without duplicating them.
- App-specific state lives in its own file, for example `data/apps/interview-prep.sqlite` (progress, sessions).
- The embedding cache is shared: `data/cache.sqlite`.
- Eval answers and judge verdicts are cached in `data/eval-cache.sqlite`, so a rerun does not pay twice (ADR-0009).
- Rerank calls are cached in `data/rerank-cache.sqlite`, one entry per call, since a score depends on the rest of its call (ADR-0014).
- Two more indexes of a source are measured against the plain one: `data/sources/<source-id>.contextual.sqlite` and `.control.sqlite` (ADR-0014). A sync never writes one of them while it builds another.
- `data/` and `.cache/` are gitignored.

## 5. Tech stack

- **Runtime and tooling:** current Node LTS, pnpm, Turborepo, TypeScript strict, ESM, Vitest, ESLint, Prettier, dependency-cruiser, Storybook. Exact versions and the reasons for them (for example TypeScript 6.0 rather than 7) are in ADR-0001.
- **Apps:** Next.js 16 App Router with streaming route handlers, bound to 127.0.0.1 (ADR-0008).
- **UI:** React 19 with CSS Modules and design tokens (light and dark), react-markdown with GFM tables for answers (no raw HTML), Storybook 10. Every story runs as a test in headless Chromium through Playwright, with axe, in both colour schemes (ADR-0008).
- **LLM:** Claude through the official `@anthropic-ai/sdk`, used directly (no third-party wrapper) so `search_result` blocks and citations are available.
  - Haiku: contextualization and question generation (cheap, with prompt caching).
  - Sonnet: answers, the interviewer.
  - Opus: the eval judge, so the model that answers does not grade its own answers.
  - Model IDs live in `packages/settings` only (ADR-0007).
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
| `manifest` | source_id, repo, branch, include_paths (json), commit_sha, synced_at, embed_model, embed_dimensions, context_model, chunker_version, parser_version |
| `documents` | id, path, url, title, doc_type, content_hash, last_changed_sha |
| `chunks` | pk, id, doc_id, ordinal, heading_path, anchor, block_types (json), text, context, metadata (json), token_count, text_hash |
| `chunks_fts` | FTS5 table over heading_path, context, text with the trigram tokenizer; external content on `chunks`, kept in sync by triggers (ADR-0005) |
| `chunks_vec` | sqlite-vec `vec0` virtual table with cosine distance: rowid = chunks.pk, doc_type (metadata column, for filters inside the KNN query), embedding |
The index is generated and can be rebuilt, so eval results are not in it: golden sets and named reports are committed files (section 10, ADR-0009). Nor is the interview bank: a `questions` table would change the index schema, which every report's identity names, so the bank is a committed file per source, `interview/bank/<source>.jsonl` (section 11, ADR-0018).

Notes on the chunk columns:
- `pk` is an explicit integer key, so VACUUM never renumbers it; it is the chunk's rowid in `chunks_vec`. `id` is the stable chunk ID.
- `ordinal` is the chunk's 0-based place in its document; the inspector orders chunk boundaries by it. The chunk ID uses a different number, the pack's place within its section.
- `context` is the contextual retrieval prefix.
- `metadata` holds things like version_introduced, error_codes and option names, plus `spans`, the character ranges of the rendered blocks in `text`, `sectionPath`, the heading path of the section the chunk starts in (the one its anchor points to), `part`, `{index, total}`, when several chunks share that path, and `anchors`, the fragments of every section the chunk contains. For a pack of sections, `heading_path` is their common parent, which is empty under the document root.

`manifest.include_paths`, `embed_model` (provider, model and dimensions), `chunker_version` and `parser_version` decide when a sync must rebuild everything (ADR-0004, ADR-0005). A rebuild re-parses every file but embeds only changed text.

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
  parserVersion: number      // bump when parse output changes; stored in the manifest
  license: { name: string; url: string; attribution: string }
  match(path: string): boolean
  parse(file: SourceFile, ctx: ParseContext): Promise<ParsedDoc>
  exactTokens?(question: string): string[] // source-specific tokens for keyword search: TS2345 -> 2345
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

Sync, diffing, hashing and chunking live in `source-kit`, and the embedding cache in `core` (ADR-0003), never in individual sources. A source only knows how to parse its own format. The `compiled` field of a code block holds the twoslash compiler's output, in the compiled index only (ADR-0017).

**Conformance suite.** Every source must pass `runSourceConformance(source, fixtures)`. It returns a list of failures (empty when the source passes):
- has a positive integer `parserVersion`;
- parses every fixture without throwing;
- produces absolute URLs that match the expected pattern, and a known `docType`;
- produces the same chunk IDs on two parses;
- produces no empty chunks;
- preserves code blocks byte-for-byte.

## 8. Initial sources

Measured:
- React, the indexed set below: 180 files, 3.14 MB (at `2177e28d`, 2026-11-05).
- TypeScript, the indexed set below: 248 files, 1.85 MB (from the GitHub tree at `205122bb`, 2026-10-31).

That is roughly 0.8M and 0.5M tokens (React: about 838K estimated tokens in 1,586 chunks; TypeScript: about 506K in 994), well above the ~200k-token size where Anthropic suggests putting a whole knowledge base in the prompt instead of using RAG.

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
- **Code examples:** fences look like ```` ```ts twoslash ```` with directives such as `// @errors: 2345` and `// ^?`. M7 compiles them with twoslash 0.3.9 and `typescript` 6.0.2, the docs' own pin, for a compiled index beside the plain one (ADR-0017). The real errors and the types of `^?` queries follow each example in the chunk text, the code stays byte for byte, and each chunk keeps the structured output in its metadata for interview questions. 654 of the 712 examples compile at `205122bb`. The ts-docs app reads the plain index: on the answers, the compiled one made no difference that holds up (ADR-0017).
- **Metadata:**
  - the release-notes version becomes `version_introduced`;
  - error codes from `@errors` are stored per document as `error_codes`. Keyword search finds them in the chunk text instead, which is per chunk, and `exactTokens` turns `TS2345` into `2345` (ADR-0005). The compiled index keeps each chunk's own error codes, from the compiler (ADR-0017).

### React
- **Repo and license:** `reactjs/react.dev`, branch `main`. Content is CC BY 4.0 (`LICENSE-DOCS.md`).
- **Pin:** `2177e28d3c3c16a8183346b9140f11ce0ee6af25`, of 2026-11-04, the head when the first full sync ran (ADR-0016). A sync without `--at` returns to the head, so a later sync of this index names that commit.
- **Paths** (markdown files and bytes at `2177e28d`; `docType` in the last column):

  | Path | Files | Bytes | docType |
  |---|---|---|---|
  | `src/content/learn/` (without `rsc-sandbox-test.md`, which tests the site's sandbox and is no page) | 51 | 1,437,594 | handbook |
  | `src/content/reference/` | 129 | 1,704,322 | reference |
  | **Total** | **180** | **3,141,916** | |

- **MDX components:** ADR-0016 records what becomes of each, from a survey of every file. A component not in that survey stops the parser, with its file and line.
  - Each visible file of a `<Sandpack>` is a code block, with its language and file name. Files marked `hidden` are dropped.
  - `<Pitfall>`, `<DeepDive>`, `<Note>` and other boxes are `callout` blocks, with the label the site shows as the variant. A long one is cut between its blocks.
  - `<Recap>`, `<Challenges>` and `<Recipes>` are sections, since each is a heading with an anchor on the site.
  - Pictures give their alt text and caption, and pure layout components leave no trace.
- **URLs:** the path under `src/content/` maps to `https://react.dev/<path>`, keeping the case, and an `index.md` stands for its folder. All 180 verified on the live site.
- **Anchors:** every heading writes its id, as `## Usage {/*usage*/}`, and the anchor is that id.
- **Status:** a page's `version` frontmatter (`experimental`, `canary`, `rc`) goes in `metadata` and beside the title, which starts every chunk, as the site shows it. Pages state no dates of their own.

## 9. Pipeline

### Sync (`drl sync <source>`)
1. Shallow, sparse, blob-less clone, or fetch, into `.cache/sources/<id>`, with `core.autocrlf=false`. Files are read with LF line endings. The checkout is the head of the branch, or with `--at <sha>` that commit, so a report can be reproduced after upstream moves. The pin is not stored: the next sync without `--at` returns to the head.
2. Find changes:
   - if the manifest has a previous SHA, run `git diff --name-status -z --no-renames <old> <new> -- <include paths>`, fetching the old commit by SHA if the shallow clone lacks it;
   - otherwise, or if the old commit is unreachable, or the chunker version, parser version, embedding model, repository, branch or include paths changed, do a full build. A full build still compares chunk hashes, so unchanged text costs nothing.
3. Apply changes:
   - deleted files: remove their documents and chunks;
   - added or modified files: parse, chunk, and compare chunk hashes.
4. Only new or changed chunks go through contextualization and embedding. Everything else comes from the cache. Embedding requests are batched and kept under the provider's rate limits (ADR-0004).
5. Update FTS and vector tables in one transaction, then write the manifest.
6. Report the golden questions whose anchors disappeared (stale) or whose anchored text changed since the lock (to review), the same check as `drl eval check` (section 10). Question-bank items whose chunks changed are marked `stale` from M8, when that table exists.

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
- The context is for retrieval only. Claude receives and cites the original chunk text, never the generated prefix (ADR-0014).
- Measured in M5: on these docs, where every chunk already carries `document > sections`, the contexts added nothing significant, alone or on top of rerank (ADR-0014).
- Contexts are committed under `eval/contexts/<source>/` with their model and prompt hash, so the index can be rebuilt without calling Haiku. The contextual index is a second file, and the plain one stays as it is, so earlier reports can still be verified.

### Retrieval
1. Vector search top 50 plus FTS5 BM25 top 50 over the question's terms, plus BM25 top 50 over its exact tokens: code in backticks, camelCase identifiers, `--flags` and source tokens (ADR-0005).
2. Reciprocal Rank Fusion (k=60, equal weights). These are not tuned: a sweep over 40 questions would fit noise (ADR-0009).
3. `rerank-3` over the top 20 (M5), in one call per question, since a score depends on the rest of its call. On the free trial the calls are paced to stay under the rate limit on average, so a wait of up to about a minute is pacing and not the reranker: one uncached call took 359 ms (ADR-0014).
4. Top K (default 8) goes to generation.

Strategies: `vector` (step 1's vector list only, ladder row 2), `hybrid` (steps 1-2, ladder row 3) and `rerank` (steps 1-3, ladder row 4, and row 5 on the contextual index). `drl ask` and `drl search` take `--strategy`. The app stays on hybrid: its chat refuses `rerank`, and the inspector offers it as an on-demand comparison, since the gain did not reach the answers (ADR-0014).

Filters: docType runs inside the KNN query (a vec0 metadata column) and the keyword query. Source is the choice of index file, one per source. Version and block type filters are not built yet.

Every retrieval returns a **trace object**: plain JSON with a version, holding every candidate list with ranks and scores, the fused ranking, the final context and timings. The inspector renders it and eval results store it. `drl search --json` prints it.

### Generation
- Sonnet receives the retrieved chunks as `search_result` content blocks with citations enabled:
  - `source` = canonical doc URL with anchor;
  - `title` = doc title + the heading path of the section the chunk starts in (`sectionPath`), plus "(part 2 of 3)" when several chunks share that path;
  - `content` = text blocks, one per rendered block of the chunk, so citations point at precise passages.
- The response is streamed, and citations are rendered inline in the UI. Core reports an answer as a sequence of events: the trace, text deltas, the citation markers of each cited text block (each citation names its context chunk), then `done` with the stop reason and the usage, tokens and estimated cost (ADR-0006). The CLI prints them; an app route sends them to the browser as NDJSON, one event per line, and ui renders the markdown without raw HTML, with each citation marker as a button that shows its chunk in the inspector (ADR-0008).
- The system prompt says: answer only from the provided results, and say so when they are not enough.

### Agentic mode
- Claude gets a `search_docs` tool (query + filters). The tool returns `search_result` blocks in its tool results.
- Claude may search several times, up to a configurable maximum number of steps.
- Agentic mode is compared against single-shot retrieval in eval.
- A candidate from M4: on ts-0024, retrieval misses, so the grounded answer refuses while Claude without RAG answers correctly. A second, agentic search is the natural fix (ADR-0012).

## 10. Evaluation

M4 built this, M5 added ladder rows 4 and 5, M6 ran rows 0, 2, 3 and 4 on React with a spot check of the judge (ADR-0016), M7 added row 7 on the compiled index (ADR-0017), and the README has the measured rows. M4's part: the golden set format, anchors, the lock, `drl eval check`, retrieval metrics and reports (`drl eval`, `verify`, `compare`), answer metrics, the judge and its calibration (`drl eval answers`, `judge-check`, `label`, `calibrate`, ADR-0012), and the dashboard at `/eval` in the ts-docs app (ADR-0013).

**Golden sets.** One file per source: `packages/sources/<id>/eval/questions.jsonl`, for example:
```json
{"id":"ts-0001","question":"...","answer":"...","primary":[{"at":"packages/documentation/copy/en/handbook-v2/Everyday Types.md#differences-between-type-aliases-and-interfaces","contains":"cannot be re-opened"}],"tags":["basic"]}
```
- Tags: `basic`, `version`, `edge`, `fresh`, `exact-token`, `cross-lingual` (a question in another language than the docs), `unanswerable` (the docs do not cover it, or its premise is false), `error-code` (what a compiler error code means, chosen by the rule in ADR-0017).
- `primary` anchors are the passages the answer was written from. The answer needs all of them, unless `"primaryMatch": "any"` says each one is enough on its own. `acceptable` anchors are other passages that also support the answer, and are never required. An unanswerable question has neither. An optional `note` says why a question is graded as it is.
- An anchor is a repo-relative document path, optionally with `#` and a section anchor. It matches a chunk of that document that starts in the section or holds its heading, which the chunker records in `metadata.anchors`. Subsections packed into other chunks do not count for their parent, and a heading with no text of its own, whose subsections are all in other chunks, matches nothing. Sections are packed into chunks (ADR-0004), so a section such as `TypeScript 5.9.md#libdts-changes` may sit inside a chunk anchored at `notable-behavioral-changes`. Without a fragment, any chunk of the document matches. Option pages have no section anchors.
- A long section spans several chunks, and a match in the wrong one is not a hit. `{"at": "...", "contains": "literal passage"}` matches only the chunks that contain the passage.
- TypeScript has 48 questions and 5 unanswerable ones, each written or reviewed by a human: 40 from M4 and 8 on error codes from M7 (ADR-0017). React gets 20: 16 answerable, of which 10 are fresh, picked strictly by the docs' own dates, and 4 unanswerable. Claude drafts them with the `write-eval-questions` skill, and a human reviews the flagged ones (ADR-0015, ADR-0016).
- `eval/questions.lock.json` records what each anchor resolved to at the set's last review, which for React covers its flagged questions. `drl eval check` compares the index with it. A question that lost an anchor it needs is stale, and metrics leave it out; one whose anchored text changed needs a review, and is still scored. `--accept` rewrites the lock (ADR-0009).
- A draft is checked with `drl eval check --draft`: which anchors of `eval/questions.draft.jsonl` do not resolve and what each question copies from the pages it is anchored to, and it fails above 2 `fresh` questions on a page, by the pages of their anchors. `drl eval walk` lists every indexed page and heading, newest first by git history at the index's commit, to pick `fresh` questions from. It keeps a clone of the docs' history under the cache, since a sync's checkout is shallow (ADR-0016).
- The set is frozen. A later change must be justified by the docs text, not by a ranking, and goes into the changelog in ADR-0009 with a new set version (`--accept --set-version <n>`). Every strategy in a report is then re-scored on that version, and numbers from two versions are never compared. The one exception is a grading note that asks for more than the rubric: by the owner's decision, it may change to match the rubric, the changelog says the change came after the answers were seen and which way it moves the result, and a fresh blind spot check decides whether the new grades are read (ADR-0009 section 9, ADR-0017).

**Retrieval metrics,** on every run, with no Claude call. They count the questions with anchors, since an unanswerable one has nothing to find.
- hit@k, for k = 1, 3, 5 and 8: a primary anchor is in the top k. With `primaryMatch: all`, the best-ranked one counts;
- recall@8: the share of primary anchors in the top 8. With `primaryMatch: any`, one is enough. The top 8 is what reaches the answer;
- MRR: the reciprocal rank of the first primary anchor, or 0 if it is below the depth of one candidate list, which is 50 for every strategy.

Primary metrics are the headline. hit@k and MRR are also reported counting acceptable anchors, as a secondary number: many of those anchors were found by looking at what the current retrievers return, which favours those retrievers.

**Answer metrics,** only on request, with the estimated cost printed first:
- correctness: a Claude judge scores 0-2 against the expected answer, grading only what the question asks;
- citation support: does each cited passage support the claim next to it? A judge decides;
- citation accuracy: do the cited chunks include a primary or acceptable anchor? This takes no judge. When the judge says a cited chunk supports a correct answer but that chunk is not an anchor, the report lists it as a candidate for review; it is never added automatically;
- refusals. On an unanswerable question, a correct answer says the docs do not cover it or, for a false premise, rejects it, and cites nothing as support for an answer. Naming a version, describing a made-up option, or presenting outside knowledge as coming from the docs is a hallucination, reported separately from a plain wrong answer. On an answerable question, saying the docs do not cover it is a false refusal;
- latency;
- tokens and cost per question;
- correct and grounded, exploratory: an answer that scores 2, has every cited claim supported, and cites an anchor. It was defined after seeing the first results and is no target. Row 0 cannot score on it by design (ADR-0012).

Answers are not deterministic, because the API has no temperature for these models. Raw answers and judge verdicts are stored with the run, and cached by the whole request. `--noise` answers rows 3, 4 and 5 twice and asks the judge twice on row 3, so a report says how far a row differs from itself.

**Noise.** 40 questions cannot resolve small differences. Reports compare runs question by question with an exact sign test, per tag and overall. A difference of one or two questions is marked as noise, a larger one with p >= 0.05 as not significant, and a win without the higher total as mixed. A tag with 5 questions or fewer cannot reach significance at all, so it is marked as too few (ADR-0010).

**Strategy ladder.** Each strategy is one row of the README table:
0. Claude without RAG
1. Long context: the whole corpus in the prompt. Only for a small subset (for example the tsconfig reference), to show where the line is.
2. Vector only
3. Hybrid (vector + BM25, RRF)
4. Hybrid + rerank
5. Hybrid + rerank + contextual retrieval
6. Agentic
7. Hybrid on the compiled index, with the twoslash output in the chunks (M7, ADR-0017)

Hybrid + contextual retrieval without the reranker is measured too, for retrieval only, to tell what each adds. It is no ladder row (ADR-0014).

**Reports:** `eval/reports/<source>/<date>-<sha>-<name>.md` plus JSON. Only named runs are committed (the baseline, the hypotheses, the answers, final); development runs go to `dev/`, which git ignores. The dashboard reads the JSON. Every report records the repository and docs commit SHAs, the golden set version, the settings and hashes of the vectors. `drl eval verify <report>` runs a report again: with the same vectors the result must match byte for byte, and with other vectors every context, count, verdict and target must match, since provider vectors are not reproducible across batches (ADR-0010).

**Judge calibration:** a human labels a sample of about 15 answers without seeing the judge's verdicts, and the report records how often they agree, with kappa and an interval. Below 13 of 15 on any dimension, the answer metrics are marked uncalibrated. Refusal agreement covers every answer, not only the unanswerable ones. The judge is a different model from the one that answers. A new round is needed only when its prompt or model changes, and React gets a spot check on 10 answers instead (ADR-0015). A report takes the rounds for its prompts and model from every source's folder, and says whose answers they were. A spot check has a file of its own, which decides no calibration (ADR-0016). When a note changes after a spot check, the labels already given are no longer blind for it, so a fresh spot check on answers that the first did not show decides whether the new grades are read (ADR-0017). Its known bias is stated wherever correctness is reported: all 4 disagreements on correctness in the calibration rounds are the judge scoring higher than the human, so correctness may be slightly inflated (ADR-0012, ADR-0014).

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

**Question bank** (ADR-0018), built by `drl questions <source>`:
- Committed as `interview/bank/<source>.jsonl`, with the docs commit and the models and prompt hashes that wrote and checked it. TypeScript's comes from the compiled index, React's from the plain one.
- Compiler questions ask which errors an example gives, or which type a `^?` query shows. They cost nothing, so every run writes them again. The code is shown as the docs site shows it, through the source's `displayCode`.
- Generated questions are written offline per chunk (Haiku), with the whole document under a cache entry: up to two theory questions, and one for each Pitfall callout. Each carries a quote that code finds in its chunk, and any code it shows is a block of the docs, never written by the model.
- A checker (Sonnet) reads every generated question against its chunk alone, and drops it when the chunk does not answer it or the stored answer is wrong. Dropped questions stay in the file with their reason.
- A rerun sends only chunks whose text changed, and a question whose chunk changed is stale and not shown.
- The topic map comes from the source's `interviewTopic`: TypeScript's Handbook and Reference pages, and its compiler options as one topic, and React's Learn pages, with its Reference pages aggregated by folder. A page about installing, setting up or configuring a tool, rather than about the language or the library itself, stays out of the bank and the topic map.
- After human approval, a question can be promoted to the eval golden set (later).

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
  - `run-eval`: run eval for a source and strategy, compare with the last report, flag regressions, write a summary. Dropped from M6 (ADR-0016): the same commands run by hand.
  - `write-eval-questions`: draft candidate golden questions with anchors, from the docs' text alone, and flag the ones a human should review (ADR-0015). It uses `drl eval walk` and `drl eval check --draft`, which look at no ranking (ADR-0016).
- **Subagents** in `.claude/agents/`:
  - `code-reviewer`: a fresh-context review against the boundaries, ADRs and tests;
  - `eval-analyst`: classifies failures as retrieval miss, generation error or bad question. Dropped from M6 (ADR-0016).
- **Hooks** in `.claude/settings.json` (committed):
  - PostToolUse on `Edit|Write`: typecheck, lint and dependency-cruiser for the touched package. Exit with code 2 on failure so the error goes back to Claude and Claude fixes it.
  - Stop: `turbo run test --filter=...[HEAD]` (tests for affected packages only).
  - PreToolUse: block reading `.env*` and writing to `data/**` and `.cache/**`.
  - Add the hooks in M0 only after the commands exist and pass on the empty scaffold. Prove each hook works.
- **`.mcp.json` (later, after v1.0):** the project's own MCP server, so Claude Code can query TS and React docs through Docs RAG Lab while building Docs RAG Lab (dogfooding).
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
| M4 | Eval harness | 40 TS questions plus 5 unanswerable, metrics, ladder rows 0, 2 and 3, reports, dashboard view | Report is reproducible from SHA + config |
| M5 | Rerank + contextual | Ladder rows 4 and 5, prompt caching, cost tracking | README table has measured rows |
| M6 | React via `/add-source` | `react-docs` app, 20 questions (ADR-0016) | Done through the skill; the PR links the session |
| M7 | Twoslash compile | Compiler output inlined, exact-token metadata. Revisit the grading of ts-0040: the handbook chunks will state the error text. The test is in ADR-0017 | `exact-token` questions improve and are measured |
| M8 | Interview-prep MVP | Scope from section 11 | You use it yourself for a real interview |
| M9 | Agentic mode | Ladder row 6 | Compared against single-shot |

**v1.0 is M5 through M9,** on top of M0 to M4, which are done (ADR-0015).

**M7's acceptance is not met,** and it stays as written: its `exact-token` questions were measured and did not improve (ADR-0017).

**Later, after v1.0:** what was M10, with no date. The Docs RAG Lab MCP server, dogfooding via `.mcp.json`, done when Claude Code uses Docs RAG Lab while working on Docs RAG Lab. Optionally more sources: Rust Book (MIT/Apache), Python docs (PSF-2.0, examples also 0BSD).

### The process from M6 on

Lighter than M4 and M5, by the owner's decision (ADR-0015):
- **Reuse** the eval harness, the calibrated judge and the dashboard.
- **React's golden set is smaller,** 20 questions: 16 answerable and 4 not. 10 of the answerable are fresh, by the docs' own dates, and 3 are in Russian. Claude drafts them, and the owner reviews only the flagged ones.
- **No new judge calibration** unless its prompt or model changes. For React, a spot check on 10 answers is enough.
- **Hypotheses and criteria are still written down before any paid run.** Set-level criteria decide, and per-question targets are diagnostics (ADR-0014). M6's are in ADR-0016, and M7's in ADR-0017.
- **Not built in M6:** the `run-eval` skill, the `eval-analyst` subagent and `turbo gen app` (ADR-0016).

### From M8 on

By the owner's decision when M7 closed (ADR-0015, section 6):
- **One main hypothesis per milestone,** with set-level criteria written down before any paid run. No chains of sub-hypotheses.
- **M8 is a product milestone,** judged mainly by the owner's hands-on review, plus tests, stories, axe and the keyboard. An eval runs only for a part that depends on retrieval or generation quality, and it stays small.
- **M9 is measured on the frozen sets only,** TypeScript's version 3 and React's version 2, with no new questions. The calibrated judge is reused, and a spot check of 10 answers runs only if the answer format changes in a way the judge has not seen.
- **Each milestone aims for 3 to 4 PRs.**

### M4 retrieval targets from M2

Hybrid search made three anchor ranks worse than vector search alone (ADR-0005, journal M2). Ranks are the anchor chunk's position in `drl search`; the top 8 go to the answer. The four questions are in the golden set as ts-0033, ts-0027, ts-0004 and ts-0040, and every report checks them against `eval/targets.json`.

| Question | M1 (vector) | M2 (hybrid) | M4 target |
|---|---|---|---|
| "In which version did `satisfies` appear?" | 1 | 3 | 1 |
| "What does the `strict` flag enable?", the `Compiler Options.md#compiler-options` anchor pinned to `--strictNullChecks`, the part with the `--strict` row | 6 | 9 | 6 or better |
| ts-0004, "В чём разница между `unknown` и `any`?" | 2 | 7 | 2 or better |
| ts-0040, "What does error TS2345 mean?" (vector: not in top 50) | - | 6 (handbook), 3 (release notes) | stays in the top 8 |

Hypotheses to check first, on the full golden set and not tuned to these four questions:
1. **Backticked plain words are counted twice.** A word like `satisfies`, `strict`, `unknown` or `any` is both a search term and an exact token, so BM25 enters the fusion twice. Check: limit exact tokens to code-shaped ones (identifiers, flags, source tokens, code with punctuation).
2. **Trigram matches 3-character terms inside other words.** `any` matches "many" and "company", so 488 of 994 chunks match it. Check: match 3-character terms as whole words, for example through a second unicode61 column or table.

Both were tested on the full set under criteria fixed first, alone and together, and neither reached the targets, so neither was adopted (ADR-0011). The M5 reranker (`rerank-3` over the fused top 20) then met ts-0027 at rank 3 and ts-0004 at rank 2, and left ts-0033 at rank 3. ADR-0014 asked for all five rows, so it is not accepted, and later ADRs treat these ranks as diagnostics.

## 14. Conventions

- TypeScript strict and ESM. No `any` without an explaining comment.
- No RAG frameworks.
- Unit tests never hit the network: fixtures live in `__fixtures__`. Network tests are tagged and opt-in.
- Secrets only come from `.env` (`ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`). `.env.example` is committed.
- Model IDs and prices live in `packages/settings` only (ADR-0007).
- Conventional commits. Every non-obvious decision gets an ADR: `docs/adr/NNNN-title.md`.
- Generated data (`data/`, `.cache/`) is gitignored. Named eval reports are committed; development runs stay local.
- Writing style in docs and comments: never use em dashes, use plain hyphens.

**Costs:**
- The Anthropic API is billed separately from a Claude subscription.
- Voyage is billed per token.
- Contextualization runs once per chunk and is kept in a committed file per docs commit, so a re-sync at that commit pays nothing. A later commit starts a new file and pays again, and the estimate says so first (ADR-0014).

## 15. Open decisions

- Commit the generated question bank, or regenerate it locally?
- Voice mode in interview prep: browser speech API, or skip it.

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
