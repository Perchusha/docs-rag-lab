# Journal

Short notes per milestone, with before/after numbers where they exist. Newest first.

## M2 - Hybrid search and the retrieval trace (2026-10-31)

**What exists now:**
- keyword search: SQLite FTS5 with the trigram tokenizer, over the heading path, context and text of every chunk, kept in sync by triggers;
- hybrid retrieval: vector search, BM25 over the question's words, and BM25 over its exact tokens (code in backticks, camelCase identifiers, `--flags`, `TS2345`), fused with Reciprocal Rank Fusion;
- doc type filters inside the KNN query (a sqlite-vec metadata column) and the keyword query;
- a retrieval trace: every candidate list with ranks and scores, the fused ranking, the final context and timings. `drl ask --verbose` prints it, and the new `drl search` prints it without calling Claude (`--json` for all of it);
- a parser version in the manifest, so a parser change re-parses on its own.

Before M2, retrieval was vector-only (M1). The design and the measurements behind it are in ADR-0005.

**Before/after.** `drl search --strategy vector|hybrid` over three groups of questions: the 7 `exact-token` questions of the draft golden set (`eval/questions.draft.jsonl`, not reviewed yet), the 3 journal questions from M1, and one cross-lingual question. Each cell is the rank of the best anchor chunk; the top 8 go to the answer.

| Question | Vector (M1) | Hybrid (M2) |
|---|---|---|
| ts-0028 `noUncheckedIndexedAccess` | 3 | 2 |
| ts-0029 `exactOptionalPropertyTypes` | 1 | 2 |
| ts-0030 `verbatimModuleSyntax` | 1 | 2 |
| ts-0031 `isolatedModules` | 1 | 1 |
| ts-0032 `skipLibCheck` | 1 | 2 |
| ts-0036 `--erasableSyntaxOnly` | 1 | 1 |
| **TS2345** (ts-0040, the M1 journal question), handbook anchors | **not in top 50** | **6** |
| **TS2345**, the TS 5.7 and 5.9 sections that print the error | **not in top 50** | **3** |
| `satisfies` (journal) | 1 | 3 |
| `strict` (journal), `strict.md` | 1 | 1 |
| `strict` (journal), the compiler options table | 6 | 9 |
| ts-0004, in Russian: `unknown` vs `any` | 2 | 7 |

An anchor chunk reaches the answer for 9 of 10 questions with vector search and 10 of 10 with hybrid. Hybrid takes 6-10 ms with a cached query vector. Nothing was tuned on these questions: RRF k=60, equal weights and 50 candidates per list are the usual defaults, and M4 tunes them on the full set.

**TS2345, before and after:**
- M1: "The search results don't define error TS2345 directly, so I can't give you an official explanation of it."
- M2 cites the TypeScript 5.9 release notes, whose compiler output reads `error TS2345: Argument of type 'ArrayBufferLike' is not assignable to parameter of type 'BufferSource'`, and concludes: "In short, the error message reads 'Argument of type X is not assignable to parameter of type Y'." It cost $0.0236.

**What hybrid made worse.** It is not a free win, and the traces show why:
- `satisfies` dropped from 1 to 3 and the Russian question from 2 to 7. Both stayed in the top 8.
- For `strict`, the compiler options table fell from 6 to 9, out of the context. The answer still lists the four options from the 2.3 notes, but now says "the search results don't explicitly state that `strict` enables" `strictPropertyInitialization` and `strictBindCallApply`. M1's answer had them from that table.
- The cause: a backticked plain word (`satisfies`, `strict`, `unknown`, `any`) is both a search term and an exact token, so BM25 counts twice in the fusion, and in the trigram index `strict` also matches every `strictX` option. Limiting exact tokens to code-shaped ones is an M4 question, decided on 40 questions, not 10.

**The tokenizer was measured, not guessed.** BM25 only, on an in-memory copy of the index; the count is how often the anchor document lands in the top 8:

| | unicode61 | porter | unicode61 + split camelCase | trigram |
|---|---|---|---|---|
| 7 `exact-token` questions | 7/7 | 7/7 | 7/7 | 7/7 |
| 10 partial option names ("unchecked index access option") | 5/10 | - | 8/10 | **10/10** |
| 6 paraphrases that name no part of the option | 5/6 | 4/6 | 5/6 | 5/6 |

Trigram costs 6.2 MB of index instead of 1.0 MB, and 0.8 ms per query instead of 0.3 ms.

**The index upgrade cost nothing.** Migrations ran in place, first on an in-memory copy of the real index, then on the real file:

| | Result |
|---|---|
| Migration 2 (keyword index, doc type column, parser version) | 218 ms. 994 vectors before and after, with the same SHA-256 over every embedding: copied, not re-embedded |
| FTS5 integrity check against the chunks table | ok, about 45 ms. It also runs inside every sync |
| First sync after it | `parser version changed from none to 1`: 248 files re-parsed, 994 chunks unchanged, **0 tokens, 2.2s** |
| Second sync | incremental, 0.9s, 0 tokens |
| Index on disk | about 14 MB compacted (7.5 MB in M1). The file here is 21 MB, 7 MB of it free pages left by the migrations, which later writes reuse |
| Tests | 204, all offline (153 in M1): db 26, source-kit 39, source-typescript 41, core 71, cli 27 |
| PostToolUse hook per edit | 2.3-3.4s (the budget is 8s) |
| M2's own API spend | 88 Voyage tokens (7 new query embeddings) and $0.0627 for the three `drl ask` answers |

**A bug that only real data showed.** The first full rebuild after migration 2 grew the keyword index from 6.2 MB to 9.0 MB, and the file from 14.2 MB to 19.3 MB:
- A sync upserts every chunk of a parsed document, and the update trigger re-indexed all of them, changed or not.
- Migration 3 adds a `WHEN` clause and merges the index segments, which brings the index back to 6.2 MB.
- A later `--full` re-parse left it at exactly 6,174,420 bytes.
- The unit tests had passed both before and after the fix; a new test now counts index segments.

**What was surprising:**
- **The docs do contain `TS2345`,** in 2 chunks: the TS 5.7 and 5.9 release notes print the compiler output. They are the only place in the corpus that shows the message. The draft anchors for ts-0040 pointed only at handbook examples, so two anchors were added. The handbook chunks write the code as `// @errors: 2345` (27 chunks), never as `TS2345`.
- **`error_codes` is per document, not per chunk.** 181 chunks in 15 documents "contain" 2345 through that metadata, against the 27 chunks that hold the directive. Matching on that metadata would have been 7x coarser than the text. Per-chunk compiler metadata belongs to M7.
- **RRF punishes a strong signal from a single list.** With two lists, BM25 put a TS2345 handbook anchor 5th, but vector search did not have it in its top 50, so the fused rank was 12th: chunks that both lists found at middling ranks beat it. A third list over the exact tokens alone brought it to 6th.
- **vec0 cannot add a column in place,** so the doc type column meant copying 994 vectors through a temporary table, with the dimensions read from the old table's SQL.
- **Source filtering needed no column.** There is one index file per source, so `--source` already picks the file. Searching several sources at once comes with the second source in M6.

**What the code-reviewer subagent caught.** It ran in a fresh context before the PR. It reproduced all 12 rows of the before/after table offline from cached query vectors, and it found no bugs in the SQL, FTS5, sqlite-vec, migration or RRF code. One of its probes proved that a failed migration 2 rolls back completely. It found these:
- **`TypeScript` and `JavaScript` counted as exact tokens.** The identifier rule took any inner capital.
  - `TypeScript` matches 831 of 994 chunks, so for 9 of the 40 draft questions the exact list was ranked by chunk length alone, with full weight in the fusion.
  - Outside backticks, only camelCase counts now. None of the 10 measured questions changed rank.
- **The journal entry was not committed** when the review started. It is now.
- **Docs that no longer matched the code:**
  - the sync step in SPEC did not list the parser version as a rebuild reason;
  - ADR-0004 still said parser changes need `--full`;
  - `packages/sources/CLAUDE.md`, which loads when Claude edits a parser, did not say to bump `parserVersion`;
  - SPEC did not say how an anchor matches a chunk when its section is packed inside a bigger chunk. 17 of the 43 `#` anchors in the draft set are such sections, including both new ts-0040 anchors.
- **Tests that did not prove their claim:**
  - the empty-exact-list test rebuilt the implementation's own fusion call; it now compares against a real run whose exact list comes back empty;
  - a comment said bare `OR` and `NOT` are searched as words, but they are stopwords;
  - `drl search --json` had no successful run; a test now seeds an index and a cached query vector.
- **Smaller fixes:**
  - `--top-k` above 4096 reached sqlite-vec's raw error; it is now capped at 100;
  - `--json` was accepted by every command; it now works only with `search`;
  - a vector with a stale doc type would have blocked every sync with no way to repair it. Kept vectors now get their document's doc type on every write, so `--full` heals it. A full re-parse takes 1.9s instead of 1.7s.

### Open items for M3
- The trace type lives in core, and `ui` may not import core. Decide whether it moves to a contracts package when the inspector needs it.
- Model IDs and prices still live in `packages/cli/src/drl.config.ts` (ADR-0004). The first app needs the same values.
- A chunk that packs several sections can get an empty heading path but a section anchor. The TS 5.9 chunk is cited as just "TypeScript 5.9", anchored at `#notable-behavioral-changes`. The inspector shows chunk boundaries, which makes this the time to look at it.

### Open items for M4
- Win back the three hybrid regressions while TS2345 stays in the top 8: the targets and the two hypotheses to check (backticked plain words counted twice, trigram matches of 3-character terms) are in SPEC section 13. Measure on the full golden set, together with RRF k and list weights; the M5 reranker is the next lever.
- Graded relevance: the TS 5.7 and 5.9 sections show the TS2345 message but not its cause, which the handbook anchors explain.
- Review and approve the draft golden set, then rename it to `questions.jsonl`.
- Version and block type filters (SPEC section 9) are not built yet.

## M1 - TypeScript ingest and CLI (2026-10-31)

**What exists now:** the first end-to-end RAG path, over the TypeScript docs.
- `drl sync typescript`:
  1. a shallow, sparse git clone of TypeScript-Website;
  2. a markdown parser;
  3. a heading-tree chunker;
  4. Voyage embeddings through a shared cache;
  5. a sqlite-vec index.

  Later syncs re-embed only chunks whose text changed.
- `drl ask`: vector search, then Claude Sonnet 5.5 answers from `search_result` blocks with native citations to typescriptlang.org sections.
- Every command that calls an API ends with the tokens it used and their cost at list prices.

Before M1 there was no RAG code. After it, the index looks like this.

**The index.** TypeScript-Website `v2` at `205122bb`:

| docType | Documents | Chunks | Estimated tokens |
|---|---|---|---|
| handbook | 18 | 131 | 69,711 |
| reference | 20 | 180 | 98,797 |
| option (tsconfig) | 137 | 144 | 37,252 |
| release-notes | 48 | 454 | 252,933 |
| other (declaration files, project config, JS) | 25 | 85 | 47,342 |
| **Total** | **248** | **994** | **506,035** |

Release notes are 46% of the chunks and half of the tokens.

**Chunk sizes, in estimated tokens:**
- percentiles: p10 218, median 532, p90 736, max 1,046;
- 827 of 994 chunks (83%) fall between 300 and 800;
- 28 chunks are under 100, mostly one-paragraph tsconfig options;
- 12 are over 800:
  - 2 are single code blocks, which may not be split (1,046 and 824);
  - 10 are 802-810, because the 800 budget counts the blocks, and the heading-path prefix line comes on top.

**Numbers.** Windows 11, Node 26.13.0, Voyage `voyage-4` on the MongoDB Atlas free trial (3 requests and 10K tokens per minute):

| What | Result |
|---|---|
| Full index | **1h 09m 35s**, of which **1h 07m 51s (97.5%) was waiting on the rate limiter**. 186 requests, no restarts |
| Tokens | 426,167 billed by Voyage, against 506,035 estimated locally (billed/estimated 0.84) |
| Full index cost | **$0.0256** at list price ($0.06 per MTok); **$0 actual**, because Atlas includes free tokens |
| Second sync, nothing changed | **0.9s, 0 tokens, $0** |
| Index on disk | `typescript.sqlite` 7.5 MB, `cache.sqlite` 4.7 MB |
| One `drl ask` | $0.017-0.020: about 7-8K input tokens (8 search results), 121-616 output tokens, at `low` effort. The query embedding costs 8-10 tokens |
| Live URL check | All 248 documents (247 distinct pages) return 200. All 675 chunk anchors exist as ids on their pages |
| Tests | 153 new, all offline: db 14, source-kit 38, source-typescript 38, core 44, cli 19 |
| Conformance | Passes over 8 byte-for-byte fixtures, and over all 248 files in a dry run |
| PostToolUse hook per edit | Median about 2.7s and max 3.6s on a cache miss, 1.0s cached. It was 2.6s and 3.0s on the scaffold; the budget is 8s |

**Three answers, as `drl ask` printed them.** Each runs with `--verbose`, which also lists the 8 retrieved chunks.

> **What does error TS2345 mean?**
>
> The search results don't define error TS2345 directly, so I can't give you an official explanation of it.
>
> The only related detail is in the `checkJs` documentation. Its example, which calls `parseFloat(3.142)` even though parseFloat only takes a string[1], is annotated with `// @errors: 2345`. With `checkJs` turned on, you get error messages from the JavaScript file.[1] This suggests TS2345 is tied to passing an argument of the wrong type to a function, but the results never say so.
>
> The "Understanding Errors" page also describes the general rule that when calling a function, each argument's type must be _assignable to_ parameter's declared type.[2] ...
>
> [1] TSConfig Option: checkJs, https://www.typescriptlang.org/tsconfig/checkJs.html
> [2] Understanding Errors, https://www.typescriptlang.org/docs/handbook/2/understanding-errors.html

- The best match had cosine distance 0.62, and none of the 8 retrieved chunks names TS2345 in its prose. Vector search alone cannot match an exact token like an error code.
- Claude said so, as the system prompt asks, and labeled its inference as an inference.
- This is the baseline for BM25 in M2 and for compiler-verified error codes in M7.
- Cost: $0.0172.

> **In which version did `satisfies` appear?**
>
> The `satisfies` operator was introduced in TypeScript 4.9.[1] TypeScript 5.0 later added a JSDoc `@satisfies` tag that does exactly the same thing[1] for JavaScript code type-checked with JSDoc annotations.
>
> [1] TypeScript 5.0 > @satisfies Support in JSDoc, https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-0.html#satisfies-support-in-jsdoc

- The top 4 hits were the 4.9 and 5.0 release-note sections.
- Claude cited the 5.0 page, whose first sentence says "TypeScript 4.9 introduced the `satisfies` operator."
- Cost: $0.0174.

> **What does the `strict` flag enable?**
>
> The `strict` flag enables all strict type-checking options[1]. ... The TypeScript 2.3 release notes list these: `strictNullChecks`, `noImplicitAny`, `noImplicitThis`, and `alwaysStrict`[2]. ... The compiler options reference shows that these options also default to `true` when `strict` is on: `strictBindCallApply`, `strictBuiltinIteratorReturn`, `strictFunctionTypes`, `strictNullChecks`, `strictPropertyInitialization`, `useUnknownInCatchVariables`[3]. ...
>
> [1] TSConfig Option: strict, https://www.typescriptlang.org/tsconfig/strict.html
> [2] TypeScript 2.3 > New --strict master option, https://www.typescriptlang.org/docs/handbook/release-notes/typescript-2-3.html#new---strict-master-option
> [3] tsc CLI Options > Compiler Options, https://www.typescriptlang.org/docs/handbook/compiler-options.html#compiler-options

- Citation [3] quotes a row of the 282-row HTML options table, which the parser turns into one line per row with cells joined by ` | `. It printed as "`--strictBindCallApply` | `boolean` | `true` if `strict` ; `false` otherwise". The stray space before the semicolon was a closing `</a>` turned into a space. That was fixed, which made the real-data test below possible.
- Best distance 0.46.
- Cost: $0.0199.

**Incremental sync on real data.** The `</a>` fix changed the parser but not the upstream docs, so `drl sync typescript --full` re-parsed all 248 files:

| | Result |
|---|---|
| Documents | 1 modified, 247 unchanged |
| Chunks | **6 changed, 988 unchanged** |
| Re-embedded | **6 chunks, 3,892 tokens, $0.0002, 2.6s** |

The other 988 kept their vectors. The acceptance test proves the same property on a fixture repository; this is the same property on the real corpus.

**What was surprising:**
- **The free trial, not the docs, sets the pace.** 97.5% of the first index was spent waiting. The sync was bound by the 3-requests-per-minute limit more than by the token limit:
  - the local estimate is 19% above the billed count (billed/estimated 0.84), so batches averaged 2.7K estimated but only 2.3K billed tokens;
  - that used only about 6.1K of the 10K tokens allowed per minute;
  - batches of about 3.6K estimated tokens (about 3K billed) fill the token budget, so the next full index should take about 50 minutes instead of 70. **The free-trial cap is now 3,600 estimated tokens**, chosen from this measured ratio of 0.84 (ADR-0004, section 7).
  - A payment method on the Atlas org (Tier 1) would cut the index to about a minute, and the free tokens would still apply.
- **Atlas reported 0 tokens for the one-word query "hello",** so the first smoke test failed on an assertion that tokens are above 0. A one-sentence input reports 24. The keys were fine; the test now embeds a sentence.
- **The free-trial limits come in an `x-api-warning` header,** not in standard rate-limit headers. `drl limits` prints it.
- **Upstream line endings vary.** About 10 files are stored with CRLF, including `Everyday Types.md`. This machine also has `core.autocrlf=true`, which would have rewritten the checkout and every hash. The fix has three parts:
  - text is normalized at read time;
  - the clone stores `core.autocrlf=false`;
  - fixtures are marked `-text`.
- **Markdown hides things.** `TypeScript 5.0.md` wraps two whole sections in an HTML comment that the site does not render, and the parser drops them the same way. The tsc options page is one 282-row HTML table, now one text line per row.
- **The chunker had to move.** SPEC put chunking in core, but the conformance suite runs inside each source and must chunk, and sources may import only source-kit. The chunker moved to source-kit. The embedding cache went to core, so source-kit is now a leaf (ADR-0003).
- **Packages may not import apps,** so `drl` cannot read an app's `rag.config.ts`. Model IDs and prices live in `packages/cli/src/drl.config.ts` until M3 (ADR-0004).
- **The new Anthropic SDK** (1.3.0) sends API version `2026-10-21`, which rejects `temperature`. The answer request sets effort instead.

**What the code-reviewer subagent caught.** It ran in a fresh context before the M1 PR, with no blocking findings. It verified its claims with probes on local `file://` repositories and a 3,000-document chunker fuzz, which found no ID collisions, empty chunks or split code blocks. It found these:
- **A changed repository URL indexed the old repository under the new URL.** The checkout fetched its original `origin`. It now re-clones when `origin` differs, with a two-repository test.
- **Two doc claims did not match the data.** "Every chunk over 800 is a code block": 10 of the 12 are prefix overshoot. "Checks every chunk has exactly one vector": the code only compared totals; it now also counts chunks without a vector.
- **A full rebuild stamped every document with the new head** as its `last_changed_sha`. That would have broken staleness in M4. The column now moves only when content changes.
- **The retry tests did not cover what their names said:**
  - no test for 5xx backoff or for giving up;
  - the cache-persistence test would pass even if the cache were written at the end.
  
  Both are now real tests, plus a 5-minute cap on Retry-After, and a failed attempt now counts 0 tokens in the limiter.
- **Smaller fixes:**
  - a fence line with an info string closed a nested fence (CHUNKER_VERSION 2);
  - a greedy comment regex could drop visible HTML between two comments;
  - `@errors` codes could run into the next line;
  - env errors skipped the usage line;
  - a failed answer stream lost its usage;
  - stack traces now need `DRL_DEBUG=1`;
  - dead code was removed.
- **After the fixes,** the CHUNKER_VERSION bump forced a full rebuild: 248 files re-parsed, 994 chunks unchanged, 0 tokens, 1.6s. None of the fixes changed a chunk of the real corpus.

### Open items for M2
- Keyword search (FTS5 with BM25) for exact tokens like `TS2345` and option names. The TS2345 question above is the first test case.
- A `doc_type` filter: release notes dominate the corpus, and 6 of the 8 hits for `satisfies` came from them. sqlite-vec metadata columns can pre-filter, and rebuilding the vector table costs no tokens, because the vectors come from the cache.
- The retrieval trace object.
- Free-trial batch size: the cap is now 3,600 estimated tokens. Measure the next full index against the estimated 50 minutes, or add a payment method.
- Parser changes need `--full` today: the manifest records the chunker version, but not a version of each source's parser. Add a source version to the manifest so a parser change forces the re-parse by itself.

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
