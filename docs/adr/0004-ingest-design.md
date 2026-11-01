# ADR-0004: Ingest design: chunks, incremental sync, embeddings and costs

- Status: accepted
- Date: 2026-10-31
- Milestone: M1
- Amended: 2026-11-01, M3: section 1 is superseded by ADR-0007

## Context

M1 builds the first end-to-end path: sync the TypeScript docs, parse, chunk, embed, store vectors and answer `drl ask` with citations (SPEC sections 9 and 13). SPEC fixes the outline but leaves these open:
- how chunks get their size and their stable IDs;
- how a sync decides what to re-embed;
- how to stay inside the Voyage rate limits;
- where model IDs and prices live, given that packages may not import apps;
- how every command reports what it spent.

ADR-0003 covers which package owns what. This ADR covers how the parts work.

## Decision

### 1. Config lives in the CLI package

`packages/cli/src/drl.config.ts` holds sources, model IDs, the embedding endpoint, model, dimensions, batch and rate limits, `topK`, answer effort, and the price table with the date and the pages it was checked against. `defineConfig` and the types come from core.

SPEC section 4 sketches `apps/ts-docs/rag.config.ts`, but packages may not import apps (`packages-not-to-apps`), so the CLI cannot read it. No model ID or price appears anywhere else; the network smoke test reads the same file. Revisit in M3, when the first app needs the same values.

Superseded in M3 by ADR-0007: the values and their types moved to the leaf package `@docs-rag-lab/settings`, which the CLI and every app import.

### 2. Chunking

- The sections of a document form a tree by heading path. A subtree that fits in 800 estimated tokens becomes one chunk, with nested headings rendered as markdown headings.
- A subtree that does not fit is cut into packs: its own blocks and the child subtrees that fit are packed in order into chunks of balanced size; a child that does not fit is chunked the same way, recursively. A pack that is exactly one child subtree takes that child's heading path and ID.
- Code blocks are never split. A prose block that alone exceeds the budget is split at line boundaries, never inside a nested code fence (a fence line with an info string does not close one); a markdown table repeats its header rows in each part.
- The 800 budget counts the rendered blocks. The prefix line and the blank lines between blocks come on top. A single code block, or a single line, longer than the budget is never split. In the TypeScript index, 12 of 994 chunks exceed 800: two single code blocks (1,046 and 824) and ten at 802-810 because of the prefix.
- Chunk text is a `Title > H2 > H3` prefix line, then the rendered blocks. `spans` records each block's character range, so generation can send one citable text block per rendered block.
- Chunk ID: the first 24 hex characters of `sha256(JSON.stringify([docPath, headingPath, occurrence, ordinal]))`. `occurrence` counts earlier sections with the same heading path in the document; `ordinal` is the pack's position within its section. `text_hash` is `sha256(text)`.
- `CHUNKER_VERSION` (now 3) is stored in the manifest; changing it forces a full rebuild.
- Since version 3 (M3), every chunk records `sectionPath`, the heading path of the section it starts in. A pack takes its parent's heading path, which is empty under the document root, so 170 chunks were cited by the document title alone ("TypeScript 5.9" for `#notable-behavioral-changes`) and 73 more by their parent section. Citation titles now use `sectionPath`. The text did not change, so the rebuild embedded nothing.

### 3. Token counts are estimated locally, billed counts come from the API

Chunk sizes and batch limits use `ceil(characters / 3.5)`. That sits between English prose (about 4 characters per token) and code (about 3), so it errs high, which keeps batches under rate limits. Billed tokens always come from the provider's response; `drl sync` prints the billed/estimated ratio. The TypeScript client's `tokenize()` needs `@huggingface/transformers` and a model download, which is far too much for a sizing heuristic.

### 4. Incremental sync works at two levels

1. Files: `git diff --name-status -z --no-renames <manifest SHA> <HEAD> -- <include paths>` lists changed and deleted files. If the old commit is not in the shallow clone (a deleted cache directory), it is fetched by SHA first.
2. Chunks: each changed file is parsed and chunked, and its chunk IDs and hashes are compared with the index. Only new or changed chunks need a vector.

A full rebuild re-parses every file but still diffs against the index, and the embedding cache serves any text it has seen, so a rebuild costs nothing after the first sync. It happens when there is no manifest, the old commit is unreachable, `--full` is given, or the chunker version, embedding model, repository, branch or include paths changed. The manifest stores the include paths for that reason (an addition to SPEC section 6); they are compared as a set, so reordering them changes nothing.

- **Repository change.** When the checkout's `origin` is not the source's repository, the checkout is deleted and cloned again. Without that, a fetch would follow the old origin.
- **Last change per document.** `documents.last_changed_sha` keeps the commit where the content last changed. A full rebuild at a new head does not move it for documents whose content hash is the same.
- **Parser changes.** Since M2, each source has a `parserVersion` that the manifest stores, and a change forces the full rebuild (ADR-0005, section 6). Before M2 a parser change needed `drl sync <source> --full`.

### 5. Line endings

Files are normalized to LF (and lose a BOM) when they are read, so hashes and code blocks do not depend on how upstream stores them; one upstream fixture, `Everyday Types.md`, is CRLF. The clone also stores `core.autocrlf=false` in its config, because a global `autocrlf=true` (this machine) would rewrite the checkout. Fixtures are marked `-text` in `.gitattributes`, so the CRLF fixture stays byte-for-byte.

### 6. Embeddings go through a provider interface and the shared cache

- `EmbeddingProvider` has an id (`voyage:voyage-4:1024`: provider, model, dimensions), limits per request and `embed(texts, inputType)`. Ingest and retrieval depend only on it, so a local model is a second implementation.
- The Voyage provider uses the official `voyageai` client with `environment` set to the Atlas endpoint from config (without it the client calls api.voyageai.com). The client's own retries are off; ours handle them. The client wraps network failures in a `VoyageAIError` without a status, which counts as retryable; any other error is a bug and is not retried.
- Atlas reports `usage.total_tokens: 0` for a one-word query and real counts for longer input. The provider passes the number on as reported.
- The cache key is `sha256(provider id, input type, text)`. Query embeddings are cached too, so a repeated question costs nothing.

### 7. Rate limiting fits the Atlas free trial

The key has no payment method, so Atlas allows 3 requests and 10K tokens per minute (it says so in an `x-api-warning` response header, which `drl limits` prints).
- A sliding one-minute window admits a request only if it fits both limits, using the batch's estimated tokens, then replaces the estimate with the billed count.
- Batches hold up to 3,600 estimated tokens. The cap is sized in billed tokens:
  - the first full index measured billed/estimated at 0.84 (426,167 billed for 506,035 estimated), so 3,600 estimated is about 3,000 billed;
  - three requests a minute then use about 9K of the 10K tokens, about 10% under the limit.
  
  The first index used 3K-estimated batches, which averaged only 2.3K billed tokens. It was bound by the request limit at about 6.1K tokens per minute and took 70 minutes. At 3,600 the same index should take about 50 minutes.
  
  The Tier 1 values (2,000 RPM, 8M TPM, about 100K-token batches) sit next to the free-trial values in config as a comment. Re-check the ratio if the estimator or the corpus changes: it is printed after every sync.
- 429, 5xx and network errors are retried, at most 6 times: Retry-After when present (capped at 5 minutes), otherwise 60s for a 429 and exponential backoff from 2s for the rest. A failed attempt still counts as a request in the window, with 0 tokens.
- The limiter adds up the time it waits, including backoff. Sync prints it in its progress lines and summary.
- Every batch is written to the cache as soon as it returns, so an interrupted sync resumes for free.

### 8. Vector storage

`chunks_vec` is a sqlite-vec `vec0` table with cosine distance, keyed by the chunk's explicit integer primary key. better-sqlite3 binds every JS number as a REAL, so keys are passed as BigInt. sqlite-vec's TEXT primary keys work in its source but are not documented, so the integer key is used. The table is recreated with the new dimensions when the embedding model changes. Each sync applies deletes, upserts, vectors and the manifest in one transaction, which also checks that every chunk has exactly one vector: no chunk lacks one, and the totals match.

### 9. Every command reports tokens and estimated cost

`UsageMeter` records billed tokens per model: embedding tokens and cache hits; Claude input, output, cache-write and cache-read tokens. The CLI prints one usage line after every command that calls an API, from a `finally` block, so a failed command still reports what was recorded before the failure:
- An answer stream that breaks part-way reports the tokens of its partial message.
- One gap remains: a Voyage response that is billed but then fails validation (the wrong number of vectors) is not counted.

Costs are estimates at the list prices in config; a model without a price is named instead of guessed. Failures print a one-line message; `DRL_DEBUG=1` adds the stack trace.

### 10. Answers use search_result blocks

Each retrieved chunk becomes a `search_result` with `source` = canonical URL plus the section anchor and `title` = doc title and the section the chunk starts in (`sectionPath`, since M3), and one text block per span, with citations enabled. The answer model and effort (`low`) come from config. The SDK sends API version `2026-10-21`, so requests carry no sampling parameters. The CLI streams text and prints `[n]` markers when each text block completes, numbering search results in order of first use, then a source list.

### 11. TypeScript source specifics

- URLs come from frontmatter `permalink`; tsconfig options link to their per-option pages, except `typeAcquisition/*`, which live at `/tsconfig/#type-<name>`.
- Anchors follow github-slugger, as typescriptlang.org does.
- HTML comments are dropped with the sections they hide (`TypeScript 5.0.md`). Other HTML becomes text: each table row on its own line with cells joined by ` | `, code in backticks, media dropped. The tsc options page is one 282-row HTML table.
- `docType` (handbook, reference, option, release-notes, other) is a typed field of `ParsedDoc`, so retrieval and eval can filter and break down by it across sources.

## Consequences

- A second sync with no upstream change costs no tokens; a docs fix costs only the chunks it touches.
- On the free trial the first full index takes about an hour, almost all of it waiting on the token limit. Tier 1 is a two-line config change.
- Chunk IDs survive edits elsewhere in a document. Edits that change how a section packs change the IDs of that section's packs, and the cache absorbs the cost for unchanged text.

## Alternatives considered

- **node:sqlite instead of better-sqlite3.** No native addon, but still a release candidate in Node 26, and SPEC and ADR-0001 already chose better-sqlite3 13, which ships N-API prebuilds.
- **A tokenizer dependency** (`gpt-tokenizer`, or Voyage's own through `@huggingface/transformers`). More accurate sizes for a lot of weight; the estimate is calibrated against billed tokens instead.
- **Anchor-based chunk IDs** (`path#anchor`). Readable, but anchors of duplicate headings shift when an earlier duplicate is added.
- **Cache-only change detection** (no hash diff against the index). It would work for embeddings, but M5 needs to know which chunks changed to re-contextualize only those.
- **Retries inside the Voyage client.** They would not count toward the limiter's waiting time, and would stack with ours.
