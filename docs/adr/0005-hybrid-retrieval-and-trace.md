# ADR-0005: Hybrid retrieval, filters and the retrieval trace

- Status: accepted
- Date: 2026-10-31
- Milestone: M2
- Amended: 2026-11-01, M3: the trace type moved to `@docs-rag-lab/contracts` (ADR-0006), and `TRACE_VERSION` 2 adds `chunks[id].sectionPath`, the section a chunk starts in

## Context

M1 retrieves by vector search alone. The journal shows the cost: for "What does error TS2345 mean?" the best match had cosine distance 0.62, and no relevant chunk was in the top 50. Release notes are 46% of the chunks and crowd out other doc types. SPEC section 9 asks for vector top 50 plus FTS5 BM25 top 50, fused with Reciprocal Rank Fusion, filters, and a trace object. SPEC leaves these open:
- which FTS5 tokenizer;
- how an exact token such as `TS2345` reaches chunks that write it differently;
- how filters reach the KNN query;
- what the trace holds;
- how a parser change triggers a re-parse.

This ADR records those choices and the measurements behind them.

## Decision

### 1. The keyword index uses the trigram tokenizer

`chunks_fts` is an FTS5 table over `heading_path`, `context` and `text`, with the trigram tokenizer.
- It is an external-content table (`content='chunks'`), so it stores only the index.
- Triggers on `chunks` keep it in sync inside the `applyChanges` transaction. That covers inserts, upserts, cascade deletes from document deletes, and the `context` writes that come with M5.
- The update trigger fires only when `heading_path`, `context` or `text` actually changes (migration 3, section 7).
- `applyChanges` runs the FTS5 `integrity-check` (rank 1, which compares the index with the content table) and rolls back on drift. On the real index the check takes about 45 ms.

The choice was measured, not guessed. The probe ran BM25 only (top 50, stopwords removed, terms OR-ed), on an in-memory copy of the real index (994 chunks at `205122bb`). It counts how often the anchor document lands in the top 8:

| Query set | unicode61 | porter + unicode61 | unicode61 + split-camelCase column | trigram |
|---|---|---|---|---|
| The 7 `exact-token` draft questions, with `TS2345 -> 2345` | 7/7 | 7/7 | 7/7 | 7/7 |
| 10 hand-written partial option names ("unchecked index access option", "strict null checks", "isolated modules option") | 5/10 | - | 8/10 | **10/10**, all in the top 3 |
| 6 hand-written paraphrases that name no part of the option | 5/6 | 4/6 | 5/6 | 5/6 |

- Trigram matches substrings, so "unchecked" finds `noUncheckedIndexedAccess` without a split-camelCase column. On trigram, that column changed nothing (10/10 either way).
- Porter stemming made the paraphrases worse.
- The costs:
  - the index data is 6.2 MB instead of 1.0 MB;
  - a query takes about 0.8 ms instead of 0.3 ms;
  - terms shorter than 3 characters cannot match;
  - 3-letter terms match inside longer words ("any" matches "many": 488 of 994 chunks).

### 2. Queries are built in core and every term is quoted

`analyzeQuery` (core):
- extracts words, drops a short list of English stopwords (TypeScript keywords such as `any`, `new` and `type` stay in) and terms shorter than 3 characters;
- quotes every term and joins the terms with OR. FTS5 syntax in a question (`OR`, `NOT`, `NEAR`, `*`, `^`, `:`, quotes) is matched as text and never parsed as an operator.

Unit tests cover `--strict`, `TS2345:`, a term with a double quote, `*`, `NEAR`, and `OR`, `AND` and `NOT`, both bare (stopwords, dropped) and in backticks (quoted and searched as text); every generated query is run against a real FTS5 table. On the real questions, frequent words do not flood the keyword list:
- "error" matches 488 chunks and "mean" 227, yet the top two hits for the TS2345 question are the only two chunks that contain `TS2345`;
- for the 7 `exact-token` questions, the keyword list puts the anchor at rank 1 to 5.

### 3. Exact tokens get their own candidate list

Hybrid fuses three lists:
- `vector`: KNN over embeddings;
- `keyword`: BM25 over the question's terms;
- `exact`: BM25 over the question's exact tokens alone. These are:
  - code in backticks;
  - camelCase identifiers outside backticks. PascalCase words are left out: outside code they are mostly product names, and `TypeScript` alone matches 831 of 994 chunks, which made an exact list of noise for 9 of the 40 draft questions. Types are usually written in backticks;
  - `--flags`;
  - source tokens.

Source tokens come from a new optional hook, `Source.exactTokens(question)`, so core stays source-agnostic. The TypeScript source turns `TS2345` into `TS2345` and `2345`, because the docs write compiler errors as `// @errors: 2345`.

How anchors are counted in this ADR: an anchor matches a chunk whose own anchor is the fragment, or that contains the section (SPEC section 10).

Why a third list: in the planning probe, BM25 put a TS2345 handbook anchor 5th, but vector search did not have it in its top 50. RRF over two lists then ranked it 12th, outside the top 8. Chunks that both lists found at middling ranks beat a chunk that one list found near the top. With the exact list it ranks 6th, and so it does in the measured run below.

**Fusion:** RRF with k=60, equal weights, 50 candidates per list. These are the usual defaults, kept from config and not tuned: M4 tunes them on the full golden set. A list with no candidates (for example, no exact tokens) is skipped, and the ranking is then identical to two-list RRF; a test proves that. Ties break by the best single rank, then by chunk ID.

**Why not a metadata match on `error_codes`:** that metadata is per document. Every chunk inherits its document's list, so 181 chunks in 15 docs claim error 2345, while only 27 chunks contain an `@errors: 2345` line. The chunk text is already chunk-level, because code blocks are kept verbatim. Per-chunk compiler metadata belongs to M7, where twoslash produces it.

### 4. Filters run inside the queries

- **docType:**
  - `chunks_vec` has a `doc_type` metadata column (sqlite-vec 0.1.9), so `doc_type = ?`, `IN (...)` and `!=` run inside the KNN query. A filtered query still returns k results; measured on the real index, it takes 0.7 ms.
  - Keyword search filters through a join on `documents` before its LIMIT.
  - Every write of a document sets its doc type on its kept vectors, so a changed type follows and any drift heals on the next `--full`. `applyChanges` checks that no vector carries a stale type. On the real index this makes a full re-parse 1.9s instead of 1.7s.
- **Source:** there is one index file per source (SPEC section 6), so the source filter is the choice of file (`--source`). A `source` column would hold the same value in every row. Searching several sources at once arrives with the second source in M6.

### 5. The trace is plain data in core

`RetrievalTrace` is plain, serializable data (`version: 1`). It records:
- the question, the strategy, the parameters and the filters;
- the query terms and exact tokens, and where each token came from;
- where the query vector came from (cache or API), with timings;
- every candidate list, with its FTS5 query, ranks, scores and score kind (cosine distance, lower is better; BM25 with the sign flipped, higher is better), or the reason it was skipped;
- the full fused ranking, with each chunk's rank in every list;
- a lookup from chunk ID to document, heading path, anchor and doc type;
- the final context as it goes to generation: citation source, title and text;
- the total time.

It lives in core for now. The ui package may not import core, so M3 decides whether the type moves to a contracts package.

### 6. A parser version in the manifest

`Source.parserVersion` is required, and the conformance suite checks that it is a positive integer. The manifest stores it, and a mismatch forces a full re-parse. Unchanged chunk text keeps its vector, so the re-parse embeds nothing. An index from before M2 has no parser version, which counts as a change:

`parser version changed from none to 1`: 248 files re-parsed, 994 chunks unchanged, 0 tokens, 2.2s.

### 7. Migrations upgrade the existing index in place

`migrate` now also accepts functions, for steps SQL cannot express.

**Migration 2** does three things:
- adds `manifest.parser_version`;
- builds the keyword index;
- moves the vectors into a `chunks_vec` with the `doc_type` column. vec0 cannot add a column in place, so the vectors are copied through a temporary table, with the dimensions read from the old table, and the migration checks the count.

It ran first on an in-memory copy of the real index, then on the real file:
- 994 vectors before and after, with the same SHA-256 over every embedding;
- 218 ms;
- integrity check ok;
- 0 tokens.

**Migration 3** fixes a bug that the first real full rebuild exposed:
- A sync upserts every chunk of a parsed document. The migration 2 update trigger re-indexed all of them, changed or not.
- The rebuild grew the keyword index from 6.2 MB to 9.0 MB and the file from 14.2 MB to 19.3 MB.
- Migration 3 recreates the trigger with a `WHEN` clause and merges the index segments (`optimize`), which brings the index back to 6.2 MB.
- A later `--full` re-parse left it at exactly 6,174,420 bytes. A test checks that rewriting unchanged chunks adds no index segments.
- Migration 2 had already run on the real index, so it stays as it is.

## Measured before/after

`drl search --strategy vector|hybrid` over the 7 `exact-token` draft questions, the 3 journal questions (ts-0040 is the journal's TS2345 question) and one cross-lingual question. Each cell is the rank of the best anchor chunk; 8 or better reaches the answer.

| Question | Vector | Hybrid |
|---|---|---|
| ts-0028 `noUncheckedIndexedAccess` | 3 | 2 |
| ts-0029 `exactOptionalPropertyTypes` | 1 | 2 |
| ts-0030 `verbatimModuleSyntax` | 1 | 2 |
| ts-0031 `isolatedModules` | 1 | 1 |
| ts-0032 `skipLibCheck` | 1 | 2 |
| ts-0036 `--erasableSyntaxOnly` | 1 | 1 |
| ts-0040 / journal: TS2345, handbook anchors | not in top 50 | **6** |
| ts-0040 / journal: TS2345, the 5.7 and 5.9 release-note anchors | not in top 50 | **3** |
| journal: `satisfies` | 1 | 3 |
| journal: `strict` (`strict.md`) | 1 | 1 |
| journal: `strict` (`Compiler Options.md#compiler-options`, the second anchor) | 6 | 9 |
| ts-0004, Russian: `unknown` vs `any` | 2 | 7 |

Per question, an anchor chunk is in the top 8 for 9 of 10 with vector search (TS2345 is the miss) and 10 of 10 with hybrid. Hybrid retrieval takes 6-10 ms with a cached query vector.

## Consequences

- Exact tokens now reach the answer: the TS2345 answer quotes the compiler message from the 5.9 release notes instead of saying the docs have nothing.
- Hybrid lowers some ranks that vector search already had right:
  - `satisfies` drops from 1 to 3;
  - the Russian question from 2 to 7;
  - the `strict` option table from 6 to 9, so it falls out of the context, and the answer no longer lists every option that `strict` turns on.
  
  One cause is visible in the traces. A backticked plain word (`satisfies`, `strict`, `unknown`, `any`) is both a term and an exact token, so BM25 counts twice in the fusion. Whether exact tokens should be limited to code-shaped tokens is a tuning question for M4, on the full set; it is not decided on these 10 questions.
- The index file is larger: about 14 MB compacted (7.5 MB in M1). The file on this machine is 21 MB, about 7 MB of it free pages left by migrations 2 and 3, which later writes reuse.
- `SearchHit` no longer carries a distance; scores live in the trace. `vectorSearch` is replaced by `retrieve()`.

## Alternatives considered

- **unicode61 or porter tokenizers.** These give a smaller index and word-level precision, but miss partial option names (5/10 against 10/10). Porter also hurt the paraphrases.
- **A split-camelCase column.** It helps unicode61 (8/10), but adds a computed column that SQL migrations cannot fill. On trigram it adds nothing.
- **Two FTS tables (unicode61 and trigram).** That means another list and another table to keep in sync, for no measured gain.
- **Weighted RRF or a smaller k instead of an exact list.** Weights are tuning, and there is no golden set to tune on before M4. The exact list says why a chunk ranks in the trace.
- **A metadata match on `error_codes`.** It works per document, so it is 7x coarser than the text (section 3).
- **A vec0 partition key for doc_type.** Partition keys suit equality on high-cardinality values. The filters here are multi-valued (`IN`, `!=`) over 5 values, which metadata columns support.
- **Post-filtering the top 50.** A filtered query could then return fewer than k results.
- **Explicit FTS writes instead of triggers.** These would make the sync visible in code, but every future write path (M5 contexts) would have to remember them.
- **A contentless FTS table.** It saves the same space as external content, but cannot use `rebuild` or the content integrity check.
