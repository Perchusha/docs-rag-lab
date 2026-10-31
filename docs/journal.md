# Journal

Short notes per milestone, with before/after numbers where they exist. Newest first.

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
  - batches of about 3.6K estimated tokens (about 3K billed) would fill the token budget and take about 50 minutes instead of 70.
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
- Free-trial batch size: try about 3.6K estimated tokens on the next full rebuild, or add a payment method.
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
