# ADR-0014: Testing rerank and contextual retrieval

- Status: accepted as the test, before any run. The results come later, in this file.
- Date: 2026-11-03
- Milestone: M5

## Context

M4's final report, `eval/reports/typescript/2026-11-03-94474c83-final`, is the baseline: docs `205122bb`, golden set version 1, hybrid at hit@8 36 of 40 and MRR 0.657. Three of the five target rows from M2 are still unmet: ts-0033, ts-0027 and ts-0004. Two fixes tested in M4 did not reach them, and SPEC section 13 names the reranker as the next lever (ADR-0011).

M5 adds ladder rows 4 and 5. This ADR fixes the test before any run, so that the result cannot shape what counts as success. Anything not written here is a separate hypothesis, written down first.

## What is measured

| Run | Index | Retrieval | Ladder row | Answers |
|---|---|---|---|---|
| Baseline | plain | hybrid, from M4's final report | 3 | from M4 |
| H3 | plain | hybrid, then rerank | 4 | yes, twice |
| Contextual alone | contextual | hybrid | none, retrieval only | no |
| H4 | contextual | hybrid, then rerank | 5 | yes, twice |
| H5 | plain | hybrid, with one weighted BM25 list | none | only if it passes, after asking |

The first four make a two-by-two, so that each effect can be read on its own:

| Comparison | What it shows |
|---|---|
| Baseline against H3 | the reranker alone |
| Baseline against contextual alone | contextual retrieval alone |
| Contextual alone against H4 | the reranker, on top of contexts |
| H3 against H4 | contexts, on top of the reranker |

RRF, k, weights, list depth, the targets and the golden set do not change.

### H3: rerank

`rerank-3` scores the fused top 20, and the top 8 of that order go to the answer. Ties keep the fused order. Ranks below 20 keep the fused order too, so MRR still has a depth of 50. Row 4 sends the chunk's text. Row 5 sends the context and the text.

**Batching.** Rerank is on the Atlas free trial, and the owner's standing decision is to add no payment method. Measured from the index with no API call, a rerank of the fused top 20 weighs a median of about 9,700 billed tokens and at most about 11,200. 17 of 45 requests would pass the limit of 10K tokens a minute by themselves, and with contexts of 100 tokens per chunk 42 of 45 would. So each question's top 20 is split into calls under the limit, with the existing rate limiter waiting between them. That takes about a minute per question, so about an hour per pass.

**This rests on a check, made first in PR 2.** A cross-encoder should score each pair of query and document on its own, so splitting should not change a score, but Voyage's embeddings do depend on the rest of the batch. So, with real documents:
- rerank the same documents in one call, then split across two calls, then in another order, and compare every score exactly;
- rerank the first call again, to tell jitter from an effect of the batch.

If every score matches, the depth stays at 20, and the result and the batching are recorded in the section below before any run. If any differs, stop and tell the owner, and a smaller depth is fixed here before any run.

**Cache.** Scores are cached per pair, by model, query and document text, in `data/cache.sqlite`. Reruns and `drl eval verify` then cost nothing. A cache per pair is only sound if the check passes.

### The batching check

To be filled in by PR 2, before any run.

### H4: contextual retrieval

For each chunk, `settings.models.contextualize` writes a short context from the whole document and the chunk, with the prompt from Anthropic's write-up. The document is sent with prompt caching: the first request for a document finishes before the others start, since a cache entry only exists once a response has begun.

**The contexts feed both indexes, as in that write-up.**
- **BM25:** `chunks_fts` already has a `context` column, kept current by triggers, and `bm25()` weighs its columns equally. Filling `context` is enough, and both keyword lists read it.
- **Embeddings:** not yet. `ingest.ts` embeds `chunk.text` today. For the contextual index it embeds the context and the text together, and the plain index is untouched.
- A test covers each of the two.

**The contexts are for retrieval only.** Claude receives and cites the original chunk text, never the generated prefix, and the judge checks citations against that same text. Otherwise a citation would quote generated text instead of the docs. `generate.ts` builds its `search_result` blocks from `hit.text` alone today, and a test holds that with a chunk whose context is set. This differs on purpose from Anthropic's write-up, which recommends passing the contextualized chunk to the model. The reranker in row 5 does read the context, since that is retrieval. The inspector may show it, labelled as generated.

**Stored, so that the index is reproducible without Haiku.** The contexts are committed as `eval/contexts/typescript/<docs sha>.jsonl`: a header with the model, the prompt hash and the docs commit, then one line per chunk with its ID, text hash and context. A sync reads this file first, and calls Haiku only for a chunk that is missing or whose text hash, model or prompt differs. They are not left only in `data/`, because a clean clone would then call Haiku again and get other text. The manifest and a report's identity record the model and prompt hash, and `chunksHash` already covers the context text. NOTICE gets a line, since the file is derived from the docs.

**A second index, so that M4 stays reproducible.** The contextual index is `data/sources/typescript.contextual.sqlite`, built at the same docs commit. `data/sources/typescript.sqlite` is never written, and its sha256 is `403465a8e1bd8296a8440aa35e78cb5d13f74ad121c5453e08936404900ca1c7` before this work. `data/cache.sqlite` only gains entries. A report has one index, so H3 and H4 are separate named reports, `m5-rerank` and `m5-contextual`, compared with `drl eval compare`.

### H5: the backtick-weighted BM25 candidate from ADR-0011

A word that came from backticks and is one lowercase word with no leading dashes, H1's rule, leaves the exact list. It counts twice in the keyword list, by appearing twice in the query. Other exact tokens stay in the exact list. So BM25 no longer enters the fusion twice for that word, and it keeps the topic signal of the keyword query.

The weight of 2 is fixed here, because it is what the word gets today, and there is no sweep. Checked on the real index: repeating a phrase in the query doubles its part of `bm25()`, at a ratio of 2.0000.

## What can move

Known before any run, from M4's final report:

- **The reranker can reach 39 of 40 primary anchors.** Hybrid has 19 at rank 1, 15 at ranks 2 to 3, 2 at ranks 4 to 8 and 3 at ranks 9 to 20 (ts-0039, ts-0022, ts-0038). ts-0024 is at rank 40, out of reach, so row 4's hit@8 cannot pass 39 of 40.
- **Every target anchor is in reach:** ts-0033 at 3, ts-0027 at 9, ts-0004 at 7, and the two ts-0040 anchors at 3 and 6. The reranker can also push those last two out of the top 8.
- **Contexts change every list,** so ts-0024 can come into reach in rows with contexts.
- **All 40 questions can move under H3 and H4,** so a significant result is possible, at 6 to 0 for example.
- **H5 changes the query of 13 questions,** H1's list in ADR-0011: ts-0002, 0003, 0004, 0007, 0010, 0012, 0025, 0026, 0027, 0029, 0033, 0034, 0035. Six of them suggested the idea (ts-0004, 0010, 0027, 0033, 0034, 0035), so they cannot be its evidence.
- **H5 cannot reach ts-0033's target by itself.** ADR-0011 found that the keyword list alone puts another chunk first there. So target T is not asked of H5.

## Integrity checks

These come first. If one fails, the numbers are not read as a result: find the cause, fix it, run again, and record here that it happened.

1. Every run on the plain index has the baseline's hashes: queries `3cbc8c2527dd`, corpus `8224c2d1af73`, chunks `ba7aae0e36d9`.
2. `vector` and `hybrid` in `m5-rerank` equal M4's final report in every field of `result`.
3. `drl eval verify` on M4's final report says byte for byte, on the same vectors, at the start, after the contextual sync and at the end. The plain index's sha256 is unchanged.
4. The contextual index has the same 994 chunk IDs and text hashes as the plain one, and 994 contexts that are not empty. `drl eval check` is clean, and the query hash is the baseline's.
5. Each rerank scores each of its documents exactly once, and the top 8 comes from the fused top 20.
6. `drl eval verify` on each M5 report says byte for byte, from the caches.
7. Every cited text in rows 4 and 5 is found in that chunk's original text.

## Criteria

All on primary anchors, on all 40 questions, against the baseline's `hybrid`.

**T. The targets.** All 5 rows of `targets.json` are met, with the file unchanged.

**G. No harm on the full set.** On each of hit@1, hit@3, hit@5, hit@8, recall@8 and MRR, overall, the baseline wins by at most 2 questions net, and the verdict is not `mixed`. Any question whose anchor leaves the top 8 is named in the result, even within noise. Per-tag results and acceptable anchors are reported, and do not decide.

| Run | Passes if |
|---|---|
| H3 | T and G |
| H4 | T and G |
| Contextual alone | T and G are reported. It has no answers, so it cannot be adopted by itself |
| H5 | G on all 40 and on the 34 questions that did not suggest it, and among ts-0033, ts-0027 and ts-0004 none is worse and at least one is better |

**A. No harm on answers,** for rows 4 and 5 against row 3. On fully correct, all citations hold and wrongly refused, row 3 is ahead by at most 2 questions net, and no verdict names row 3. Refused rightly has 5 questions, which is too few to decide.

**Correct and grounded.** It stays exploratory, as ADR-0012 defines it, and it decides nothing. The question is still fixed now: a row has moved it if the verdict against row 3 names that row and the margin passes twice the larger run-to-run count of the two, ADR-0013's heuristic. Row 3's count is 4, so that takes at least 9 net. The direction and the split are reported either way, with "may run high" beside them.

**The judge.** The prompts and the model do not change. As SPEC section 10 asks, a human labels 15 fresh answers from rows 4 and 5, blind, against the bar of 13 of 15 per dimension. A miss marks those metrics uncalibrated, and the prompt does not change without the owner.

## What happens next

- **After the retrieval runs:** report to the owner and stop. No answers run until the owner says so, whatever the result.
- **Neither H3 nor H4 passes T, G and A:** nothing is adopted, and the defaults stay. Report that and stop, with no new variants and no change to a target or a threshold. The rows are still in the README, since they are measured.
- **Only one passes:** it becomes the candidate.
- **Both pass:** H3, the simpler one, unless H4 alone meets T, or `drl eval compare` of H3 and H4 calls H4 better on overall MRR or hit@1.
- **Contextual alone passes, and neither H3 nor H4 does:** stop and ask.
- **H5 passes:** stop and ask, since rows 4 and 5 would then be run again on top of it, for about $3.70.
- **A candidate does not change the app by itself.** On the free trial a rerank takes up to about a minute per question, which a chat cannot wait for. Whether the app's default moves is the owner's decision, after the result.

## Estimates

Made from the index and from M4's recorded costs, with no API call. Prices were checked again on 2026-11-03.

| Item | Estimate |
|---|---|
| Haiku 5.5, 994 contexts, with prompt caching | $0.20, up to $0.30 at 300 tokens out per chunk. $0.62 without caching |
| Voyage embeddings, 490K to 575K tokens | 59 to 69 minutes on the free trial, at M4's measured pace |
| Voyage rerank, two passes, about 935K tokens | about an hour per pass |
| Rows 4 and 5, answers and judge | $3.70, at $1.85 per row as M4 measured |
| A second run of both rows | $3.70 |
| **Claude, in all** | **about $7.60**, or about $11.30 if H5 passes |

Voyage's tokens stay inside the 200M free tokens per model, and without a payment method there is no bill. Prompt caching is used for contexts only: in answers the context differs per question, so it would not hit, and it would change the requests M4's rows are cached under.

**The rule to stop.** Any command that spends prints its estimate first and waits for `--yes`. If the forecast for M5 passes $15 after a pilot, stop and ask.

## Alternatives considered

- **A payment method on Atlas.** It would end the waiting and the batching. The owner has decided against it.
- **A smaller depth from the start.** It would fit the limit, but the SPEC says 20, and depth below 20 is only for the case where the batching check fails.
- **Contexts in the existing index, with a toggle.** It would change `chunksHash`, and M4's reports could no longer be verified.
- **Passing the contexts to Claude,** as Anthropic's write-up recommends. Native citations quote what Claude receives, so they could quote generated text.
- **Contextual alone as a ladder row.** The ladder in the SPEC is unchanged. It is measured so that H4 can be read, and it has no answers.
- **Contexts only in `data/`.** A clean clone could not rebuild the index without Haiku, and would get other text.
