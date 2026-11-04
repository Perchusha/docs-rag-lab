# ADR-0014: Testing rerank and contextual retrieval

- Status: accepted as the test, before any run. The retrieval runs and the answers are in (see the two results): neither H3 nor H4 meets T, so neither is accepted. The app stays on hybrid, and rerank becomes an on-demand comparison in the inspector.
- Date: 2026-11-03. Batching and the cache changed on 2026-11-04, after the batching check and before any run. The control row was added the same day, before any retrieval number existed. The retrieval results and the answers came the same day.
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
| Control | control, a prefix from the headings instead of Claude | hybrid | none, retrieval only | no |
| H4 | contextual | hybrid, then rerank | 5 | yes, twice |
| H5 | plain | hybrid, with one weighted BM25 list | none | only if it passes, after asking |

The first four make a two-by-two, so that each effect can be read on its own:

| Comparison | What it shows |
|---|---|
| Baseline against H3 | the reranker alone |
| Baseline against contextual alone | contextual retrieval alone |
| Contextual alone against H4 | the reranker, on top of contexts |
| H3 against H4 | contexts, on top of the reranker |
| Baseline against control | saying the headings a second time, as a prefix |
| Control against contextual alone | what Haiku's words add beyond that |

RRF, k, weights, list depth, the targets and the golden set do not change.

### H3: rerank

`rerank-3` scores the fused top 20, and the top 8 of that order go to the answer. Ties keep the fused order. Ranks below 20 keep the fused order too, so MRR still has a depth of 50. Row 4 sends the chunk's text. Row 5 sends the context and the text.

**One call per question.** Each question's top 20 goes to Voyage as one call, so that all its scores come from the same set of documents. The check below ruled out splitting it.

**Paced, with no spend.** Rerank is on the Atlas free trial, and the owner's standing decision is to add no payment method. The real constraint is no spend. The limit of 10K tokens a minute only mattered as a way to avoid rejections. Measured from the index, at the largest billed-to-estimated ratio the check saw, a top 20 weighs at most about 11,100 billed tokens, and 17 of 45 pass 10K by themselves. With contexts of 100 tokens per chunk it is at most about 13,100, and 44 of 45 do. Voyage accepted the largest call as one request, a minute after the check, and again a minute later with about 100 tokens more per document: 10,936 and 12,871 billed tokens. So calls over 10K are sent, and the rate limiter paces them so that the average stays under 10K a minute: a call of 12K holds the next one for 72 seconds. A pass takes 45 to 55 minutes.

**The fallback, fixed before any result.** A 429 can be a pacing collision, not a rejection of the call itself. So on a 429 the reranker sends nothing for `Retry-After` or a full minute, whichever is longer, with a `Retry-After` over five minutes counted as five, and then retries that same call once. A 429 again, after that idle window, is a rejection. Any other 4xx is a rejection at once. A server error or a network failure is not a rejection, and is retried as usual. A rejection stops the run and the owner is told. The fallback is a depth of 15 for both rows, and no other depth: at 15 the largest call stays under 10K with contexts of up to 100 tokens per chunk. What was measured before the switch is not read as a result, so the calls for rows 4 and 5 are made before either row's numbers are read, and both rows run again at 15. At that depth ts-0038, at rank 17, is out of the reranker's reach. In practice the calls come first, from development runs whose output goes unread, and the named runs then replay them from the cache in seconds.

**A run that survived 429s says so.** The owner asked for this: each call keeps how many 429s it survived, also in the cache, and a run's output and its report's `run.rerank` give the total. A report replayed from the cache says the same as the run that made the calls.

**Cache.** Scores are cached per call, by model, query and the documents as sent, in `data/rerank-cache.sqlite`, not per pair: a pair's score depends on the rest of its call. A cached call replays the scores exactly, so reruns and `drl eval verify` cost nothing. It is a file of its own, so that `data/cache.sqlite` keeps its schema and M4's reports never touch it.

### The batching check

A finding, made first in PR 2, on 2026-11-04, with `drl eval rerank-check`. A cross-encoder should score each pair of query and document on its own, but Voyage's embeddings depend on the rest of the batch, so this was measured before any run. Each of ts-0025, ts-0032 and ts-0036, the first answerable questions whose fused top 20 fits the limit, was scored in one call of all 20. Then every score was compared exactly with that call's:

| Composition | Scores compared | Differ | Largest difference |
|---|---|---|---|
| The same call again | 60 | 0 | 0 |
| The same documents, reversed | 60 | 0 | 0 |
| Two halves | 60 | 4 | 0.00000006 |
| The split first planned here, three calls under 3,600 estimated tokens each | 60 | 11 | 0.00047 |
| The shortest, middle and longest document, each alone | 9 | 6 | 0.00047 |

**Identical sets give identical scores, in any order. Different sets shift some scores, by up to 0.0005.** So the split first planned here, and a cache per pair, were not sound: a question's scores would have come from different sets and been compared with each other. The order of the compared documents did not change in any of these, but three questions are too few to rely on that. Why scores shift is not known. Padding within a batch would explain it, and that was not tested.

This section first said to split each top 20 under the limit if every score matched, and otherwise to fix a smaller depth. The owner chose to keep the depth, in one call per question, with the fallback above.

### H4: contextual retrieval

For each chunk, `settings.models.contextualize` writes a short context from the whole document and the chunk, with the prompt from Anthropic's write-up. The document is sent with prompt caching: the first request for a document finishes before the others start, since a cache entry only exists once a response has begun. A document with one chunk to write pays for no cache entry. The document is the chunks of that document joined, which is what the index holds. Thinking is off and effort is low, since a context is a sentence or two, and a reply cut off at 300 tokens or refused is not kept: the run stops, and keeps what it has. An em dash in a context becomes a hyphen, since the file is committed and the repository holds none.

**The contexts feed both indexes, as in that write-up.**
- **BM25:** `chunks_fts` already has a `context` column, kept current by triggers, and `bm25()` weighs its columns equally. Filling `context` is enough, and both keyword lists read it.
- **Embeddings:** not yet. `ingest.ts` embeds `chunk.text` today. For the contextual index it embeds the context and the text together, and the plain index is untouched.
- A test covers each of the two.

**The contexts are for retrieval only.** Claude receives and cites the original chunk text, never the generated prefix, and the judge checks citations against that same text. Otherwise a citation would quote generated text instead of the docs. `generate.ts` builds its `search_result` blocks from `hit.text` alone today, and a test holds that with a chunk whose context is set. This differs on purpose from Anthropic's write-up, which recommends passing the contextualized chunk to the model. The reranker in row 5 does read the context, since that is retrieval. The inspector may show it, labelled as generated.

**Stored, so that the index is reproducible without Haiku.** The contexts are committed as `eval/contexts/typescript/<docs sha>.jsonl`: a header with the model, the prompt hash and the docs commit, then one line per chunk with its ID, text hash and context. A sync reads this file first, and calls Haiku only for a chunk that is missing or whose text hash, model or prompt differs. They are not left only in `data/`, because a clean clone would then call Haiku again and get other text. The manifest and a report's identity record the model and prompt hash, as `model:hash` in the existing `contextModel`, and `chunksHash` already covers the context text. There is no schema change, since a migration would write the plain index and change `indexSchema`, and M4's reports could no longer be compared. The file is per docs commit, so a later commit starts a new one and pays again. That is enough while this index stays at one commit, and the estimate says so before anything is spent. NOTICE gets a line, since the file is derived from the docs.

**A second index, so that M4 stays reproducible.** The contextual index is `data/sources/typescript.contextual.sqlite`, built at the same docs commit, which it takes from the plain index, so a contextual sync takes no `--at`. It reads every chunk each time, and embeds only what the index and the cache do not hold. `data/sources/typescript.sqlite` is never written, and its sha256 is `403465a8e1bd8296a8440aa35e78cb5d13f74ad121c5453e08936404900ca1c7` before this work. `data/cache.sqlite` only gains entries. A report has one index, so H3 and H4 are separate named reports, `m5-rerank` and `m5-contextual`, compared with `drl eval compare`.

### The contextual index as built

Built on 2026-11-04, after a pilot of 10 chunks that came to $0.0023 and forecast $0.27. No retrieval number exists yet.

| | Estimate | Measured |
|---|---|---|
| Haiku, 994 contexts | $0.20, up to $0.30 | $0.28, or about $0.91 without caching |
| Tokens in | | 790,228 uncached, 7,175,817 cache read, 597,294 cache write |
| Tokens out | about 100 per context | 107,225, or 108 per context |
| Voyage embeddings | 490K to 575K tokens, 59 to 69 minutes | 491,265 tokens in 183 requests, about 60 minutes |

The contexts are 152 to 522 characters, with a median of 312, and the committed file is 445 KB. 993 of the 994 open with "This chunk" or "This section", so those words are in almost every chunk's context.

Checked with no API call:
- **Integrity check 3, after this sync:** `drl eval verify` on M4's final report says byte for byte, and the plain index's sha256 is unchanged.
- **Integrity check 4, so far:** `drl eval check --contextual` finds the same 994 chunk IDs and text hashes at the same commit, 994 contexts that are not empty, and a clean golden check. The query hash waits for the first run.
- **The contexts feed both indexes, on the real data, for all 994 chunks:** the stored vector is the cached vector of the context and the text, and the plain index holds no such vector. A word that only the context has finds the chunk by keyword.
- **The file holds what the index holds,** in chunk ID order, with model `claude-haiku-5-5` and prompt hash `75010bc9e7d5`.

### The control: a prefix from the headings

The owner added this row to tell whether Haiku's contexts add anything beyond the heading metadata. It is the contextual pipeline, but each chunk's context is `document title > section path`, written by code with no call to Claude. It feeds the embeddings and BM25 the same way. It is `data/sources/typescript.control.sqlite`, at the same docs commit, and nothing needs committing, since the prefix comes from the chunk. It is measured for retrieval only, under `vector` and `hybrid`, with no answers and no reranker. A row with the reranker would be a separate hypothesis.

**The chunk text already holds these headings, which changes what the control means.** Measured on the plain index, with no API call, for all 994 chunks:
- Every chunk starts with a line `title > heading path`, so the title and the heading path are in the text of all 994.
- For 751 chunks that line is exactly the control's prefix.
- For the other 243, a pack of sections whose heading path is only their common parent, the prefix also names the section the chunk starts in. Each of those headings is in the text too, as a heading line of its own.
- `chunks_fts` also indexes `heading_path` as a column of its own.

So the prefix adds no word that a chunk does not already hold, and the baseline is already "the chunk with its headings". The control cannot show what headings are worth against none. What it can show:
- **Baseline against contextual alone** already asks whether Haiku's contexts add anything beyond headings said once.
- **Baseline against control** shows what saying them twice does: more weight on heading words in BM25, and a vector that leans on them.
- **Control against contextual alone** tells apart two reasons contexts could help. Both rows put a prefix in the same place, so if contextual alone beats the baseline but not the control, the gain came from repeating what the chunk already says, not from what Haiku wrote.

### H5: the backtick-weighted BM25 candidate from ADR-0011

A word that came from backticks and is one lowercase word with no leading dashes, H1's rule, leaves the exact list. It counts twice in the keyword list, by appearing twice in the query. Other exact tokens stay in the exact list. So BM25 no longer enters the fusion twice for that word, and it keeps the topic signal of the keyword query.

The weight of 2 is fixed here, because it is what the word gets today, and there is no sweep. Checked on the real index: repeating a phrase in the query doubles its part of `bm25()`, at a ratio of 2.0000.

As in ADR-0011, this is a setting on a branch of its own, `exp/m5-h5`, measured under `vector` and `hybrid`. A tag keeps the commit that measured it, and the code reaches main only if it is adopted.

## What can move

Known before any run, from M4's final report:

- **The reranker can reach 39 of 40 primary anchors.** Hybrid has 19 at rank 1, 15 at ranks 2 to 3, 2 at ranks 4 to 8 and 3 at ranks 9 to 20 (ts-0039, ts-0022, ts-0038). ts-0024 is at rank 40, out of reach, so row 4's hit@8 cannot pass 39 of 40, or 38 of 40 at the fallback's depth.
- **Every target anchor is in reach, also at the fallback's depth:** ts-0033 at 3, ts-0027 at 9, ts-0004 at 7, and the two ts-0040 anchors at 3 and 6. The reranker can also push those last two out of the top 8.
- **Contexts change every list,** so ts-0024 can come into reach in rows with contexts.
- **All 40 questions can move under H3 and H4,** so a significant result is possible, at 6 to 0 for example.
- **H5 changes the query of 14 scored questions:** ts-0002, 0003, 0004, 0007, 0010, 0012, 0024, 0025, 0026, 0027, 0029, 0033, 0034, 0035, and of the unanswerable ts-0045, which is not scored. This first said 13, taking H1's list in ADR-0011. H1 leaves ts-0024 out because its exact query only changes case, from `string` to `String`, which the trigram index ignores, and H5 also doubles `string` in the keyword query. This was found from the query plans, with no index and no rank, before any run. Six of the questions suggested the idea (ts-0004, 0010, 0027, 0033, 0034, 0035), so they cannot be its evidence.
- **H5 cannot reach ts-0033's target by itself.** ADR-0011 found that the keyword list alone puts another chunk first there. So target T is not asked of H5.

## Integrity checks

These come first. If one fails, the numbers are not read as a result: find the cause, fix it, run again, and record here that it happened.

1. Every run on the plain index has the baseline's hashes: queries `3cbc8c2527dd`, corpus `8224c2d1af73`, chunks `ba7aae0e36d9`.
2. `vector` and `hybrid` in `m5-rerank` equal M4's final report in every field of `result`.
3. `drl eval verify` on M4's final report says byte for byte, on the same vectors, at the start, after the contextual and control syncs and at the end. The plain index's sha256 is unchanged.
4. The contextual and control indexes each have the same 994 chunk IDs and text hashes as the plain one, and 994 contexts that are not empty. `drl eval check` is clean, and the query hash is the baseline's.
5. Each question's rerank is one call, which scores each of its documents exactly once, and the top 8 comes from the fused top 20.
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
| Control | T and G are reported. It has no answers, so it cannot be adopted by itself |
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
- **The control decides nothing by itself.** `drl eval compare` of the control and contextual alone is reported with the rest. If it does not call contextual alone better on overall MRR or hit@1, stop and ask before H4 is adopted, since Haiku's contexts would then show nothing that a prefix from the headings does not.
- **H5 passes:** stop and ask, since rows 4 and 5 would then be run again on top of it, for about $3.70.
- **A candidate does not change the app by itself.** On the free trial a rerank takes up to about a minute per question, which a chat cannot wait for. Whether the app's default moves is the owner's decision, after the result.

## Result of the retrieval runs

Measured on 2026-11-04. No row met T, so neither H3 nor H4 can pass, whatever the answers show. Nothing is adopted, and the defaults and the code on main stay as they are. The sections above are unchanged from before the runs, apart from the status and date lines. The answers came after this, in their own section below.

The integrity checks that apply so far all passed, and are listed below. On primary anchors, on all 40 questions:

| Target | Baseline | H3 | Contextual alone | H4 | Control | H5 |
|---|---|---|---|---|---|---|
| ts-0033, rank 1 | 3 | 3 | 4 | 3 | 4 | 2 |
| ts-0027, pinned to `--strictNullChecks`, rank 6 or better | 9 | 3, met | 6, met | 4, met | 8 | 10 |
| ts-0004, rank 2 or better | 7 | 2, met | 5 | 3 | 7 | 4 |
| ts-0040, release notes, top 8 | 3, met | 2, met | 2, met | 2, met | 3, met | 3, met |
| ts-0040, handbook, top 8 | 6, met | 6, met | 5, met | 6, met | 6, met | 6, met |
| **Rows met** | 2 of 5 | **4 of 5** | 3 of 5 | 3 of 5 | 2 of 5 | 2 of 5 |

| Full set | Baseline | H3 | Contextual alone | H4 | Control | H5 |
|---|---|---|---|---|---|---|
| hit@1 / 3 / 5 / 8 | 19 / 34 / 35 / 36 | 31 / 39 / 39 / 39 | 22 / 32 / 35 / 35 | 33 / 38 / 39 / 39 | 17 / 33 / 35 / 36 | 18 / 32 / 35 / 35 |
| recall@8 | 0.881 | 0.948 | 0.863 | 0.954 | 0.887 | 0.856 |
| MRR | 0.657 | 0.867 | 0.693 | 0.886 | 0.634 | 0.644 |
| T | | no | no | no | no | not asked |
| G | | yes | yes | yes | no, on MRR | yes |

- **Left the top 8:** ts-0035 under contextual alone, 1 to 9, and under H5, 1 to 10. Nothing under H3, H4 or the control.
- **Came into the top 8:** under H3, ts-0022 15 to 2, ts-0038 17 to 1, ts-0039 13 to 3. Under H4, ts-0022 15 to 1, ts-0038 17 to 1, ts-0039 13 to 4.
- **The control's G:** on MRR the baseline is ahead on 5 questions and the control on 2, a net of 3 against a limit of 2, and not significant. It decides nothing.

`drl eval compare`, overall, on primary anchors. "Better on" counts the questions where the first and the second row is ahead:

| Comparison | hit@1 | Better on | p | MRR | Better on | p | Verdict |
|---|---|---|---|---|---|---|---|
| Baseline against H3, the reranker alone | 19 to 31 | 0 / 12 | < 0.001 | 0.657 to 0.867 | 0 / 18 | < 0.001 | H3 better on both |
| Baseline against contextual alone | 19 to 22 | 2 / 5 | 0.453 | 0.657 to 0.693 | 5 / 11 | 0.210 | not significant |
| Baseline against H4 | 19 to 33 | 0 / 14 | < 0.001 | 0.657 to 0.886 | 0 / 20 | < 0.001 | H4 better on both |
| Contextual alone against H4, the reranker on top of contexts | 22 to 33 | 0 / 11 | 0.001 | 0.693 to 0.886 | 0 / 16 | < 0.001 | H4 better on both |
| H3 against H4, contexts on top of the reranker | 31 to 33 | 0 / 2 | 0.500 | 0.867 to 0.886 | 2 / 3 | 1.000 | noise |
| Baseline against control, the headings said twice | 19 to 17 | 2 / 0 | 0.500 | 0.657 to 0.634 | 5 / 2 | 0.453 | noise, not significant |
| Control against contextual alone, Haiku's words beyond a prefix | 17 to 22 | 1 / 6 | 0.125 | 0.634 to 0.693 | 4 / 12 | 0.077 | not significant |
| Baseline against H5 | 19 to 18 | 1 / 0 | 1.000 | 0.657 to 0.644 | 2 / 4 | 0.688 | noise |

What this says:
- **The reranker is what moves the full set.** Under H3, 18 primary ranks go up and none goes down, and the baseline is ahead on no question on any of the six metrics. On acceptable anchors too: hit@1 27 to 37, MRR 0.787 to 0.942. Its hit@8 of 39 is the limit this ADR named, since ts-0024, at rank 40, is out of reach. H4 leaves it at 37, also out of reach.
- **H3 misses T on one row.** ts-0033 stays at 3 against a target of 1. The chunk on `@satisfies` in TypeScript 5.0 stays first, and the other chunk of the section, part 2 of 2, comes second, above the anchor's part 1 of 2. T asks for all five, so this is a fail. The target does not change. H4 also misses ts-0004, at 3 against 2.
- **Contexts show no gain, alone or on top of the reranker.** Alone they are not significant against the baseline. On top of the reranker they are noise. The direction is up, by 0.036 and 0.019 of MRR. Alone they also push ts-0035 out of the top 8, and the reranker brings it back to 1 in H4.
- **Haiku's words are not shown to beat a prefix from the headings.** `drl eval compare` does not call contextual alone better than the control on hit@1 or MRR, so the stop-and-ask rule applies. H4 is no candidate, so nothing waits on it. The direction favours the contexts, at 4 / 12 on MRR, and 40 questions do not settle it.
- **Saying the headings twice shows no gain.** It moves seven primary ranks and no hit@8, and the small MRR difference favours the baseline.
- **H5 fails.** ts-0033 goes 3 to 2 and ts-0004 7 to 4, but ts-0027's pinned anchor goes 9 to 10, and the criterion asks that none gets worse. G passes on all 40 and on the 34. On the 34 no hit metric moves, and the one rank that does is ts-0024, 40 to 36. It also keeps little of the topic signal ADR-0011 hoped for: against H1, ts-0027 is at 10 instead of 14, ts-0034 at 4 instead of 5, and ts-0035 at 10 instead of 11, still out of the top 8. The code stays at the tag `exp/m5-h5`, and rows 4 and 5 do not run again on top of it.

Per tag, MRR on primary anchors, reported and deciding nothing:

| Tag | Questions | Baseline | H3 | Contextual alone | H4 | Control | H5 |
|---|---|---|---|---|---|---|---|
| basic | 15 | 0.700 | 0.835 | 0.765 | 0.857 | 0.678 | 0.719 |
| cross-lingual | 4 | 0.550 | 0.875 | 0.568 | 0.833 | 0.550 | 0.577 |
| edge | 14 | 0.671 | 0.881 | 0.760 | 0.911 | 0.671 | 0.671 |
| exact-token | 10 | 0.617 | 0.900 | 0.733 | 0.950 | 0.567 | 0.617 |
| fresh | 4 | 0.409 | 0.833 | 0.410 | 0.813 | 0.411 | 0.409 |
| version | 7 | 0.643 | 0.833 | 0.504 | 0.833 | 0.560 | 0.526 |

### What to keep from this

**The verdict stands as the rules give it.** H3 is not accepted under this ADR, and nothing in its criteria changes, now or after the answers. Whether the app uses the reranker is a product decision of the owner's, apart from this verdict. It is recorded with the answers below: hybrid stays the default.

**A lesson for later ADRs: set-level criteria decide, and per-question targets are diagnostics.** T is a hard gate per question, so one question, ts-0033, vetoed a set-level gain that is significant and has no regression: H3 takes hit@1 from 19 to 31 and MRR from 0.657 to 0.867, with no question worse on any retrieval metric. A rank on one question says where to look. It should not be able to overrule the whole set.

**The contexts added nothing significant on these docs.** Here every chunk already carries `document > sections`, and the Haiku contexts added nothing significant, alone or on top of rerank.

### Integrity

1. **Passed.** `m5-rerank` and `m5-h5` have queries `3cbc8c2527dd`, corpus `8224c2d1af73`, chunks `ba7aae0e36d9`.
2. **Passed.** In `m5-rerank`, every field of `result` equals M4's final report for `vector` and `hybrid`: `scored`, `stale`, `review`, `unanswerable`, `comparison`, both strategies, and both ranks of each target. `chunks` keeps every entry of the final report. The rerank strategy only adds to these.
3. **Passed.** After all the runs, `drl eval verify` on M4's final report says byte for byte, on the same vectors, and the plain index's sha256 is still `403465a8...`.
4. **Passed.** `drl eval check --contextual` and `--control` each find the plain index's 994 chunks at its commit, 994 contexts and a clean golden set. The query hash of both reports is `3cbc8c2527dd`. For the control's 994 chunks: each prefix is the title and section path, the stored vector is the cached vector of the prefix and the text, the plain index holds no such vector, and no prefix has a word of six letters or more that its chunk's text and headings do not hold.
5. **Passed.** The traces of both rows were computed again through the engine, from the caches, with providers that throw on any call, and none was attempted. For all 40 questions of each row, the rerank came from one cached call, scored the fused top 20 once each, and the top 8 came from that. The context and primary rank match the report. `data/rerank-cache.sqlite` holds 80 calls, the 40 of each row.
6. **Passed.** `drl eval verify --record` says byte for byte for `m5-rerank`, `m5-contextual` and `m5-control`, from the caches. `m5-h5` says the same at its own commit with `--weight-backticks`. Without that flag it is not comparable, which is correct: this branch has no such setting.
7. Passed, with the answers: see their result.

### What it took

| | Estimate | Measured |
|---|---|---|
| Rerank, row 4 | about 935K tokens for both rows, 45 to 55 minutes per pass | 389,162 tokens in 40 calls, 40 minutes |
| Rerank, row 5 | | 445,438 tokens in 40 calls, 44 minutes |
| Voyage embeddings of the control | about 430K tokens, 50 to 60 minutes | 438,230 tokens in 156 requests, 52 minutes |

**Voyage rejected nothing, and no call met a 429,** so depth 20 stands and the fallback was not used. Both reports say `rerank: 40 calls, none retried after a 429`. The calls have a median of 10,503 billed tokens and a largest of 13,330, so at least half passed 10K by themselves and were paced, as planned. Rerank came to about $0.04 at list prices, inside the free tokens, with no bill. The calls were made by development runs whose output nobody read, and the named runs replayed them from the cache.

### Reproducing this

The reports are `eval/reports/typescript/2026-11-04-1339ab72-m5-rerank`, `2026-11-04-d93f3325-m5-contextual`, `2026-11-04-62a32167-m5-control` and `2026-11-04-cdb7ef48-m5-h5`, each with `.json`, `.md` and what verify found.

```
pnpm drl eval verify eval/reports/typescript/2026-11-04-1339ab72-m5-rerank.json
pnpm drl eval verify eval/reports/typescript/2026-11-04-d93f3325-m5-contextual.json
pnpm drl eval verify eval/reports/typescript/2026-11-04-62a32167-m5-control.json
```

With this machine's `data/` these take seconds. Nothing in `data/` is committed, so elsewhere the indexes and rerank calls have to be made again, and new vectors bring `verify`'s second bar (ADR-0010).

H5's code never reached main. The tag `exp/m5-h5` keeps the commit that measured it, `cdb7ef4`. It changes no schema, so the same `data/` serves. Check out the tag with a copy of the report outside the tree, and add `--weight-backticks` to `verify`.

## Answers for rows 4 and 5

The owner asked for these on 2026-11-04, twice each, as recorded above. They cannot change the verdict on H3 or H4, since T has already failed. They are what the ladder's rows 4 and 5 report.

How they run, written before the run:
- **One report, `m5-answers`.** `drl eval answers --name m5-answers --rows 0,2,3,4,5 --noise` answers every row. Rows 0, 2 and 3 replay from M4's cache and pay nothing, so that the comparisons with row 3 and the labels work within one report, as they did in M4.
- **It names the index row 5 read.** The report's retrieval section is of the plain index, with `vector`, `hybrid` and `rerank`. Row 5 reads the contextual index, and its retrieval stays in `m5-contextual`. So the answers section says which contexts and chunks row 5 read, and the run first checks that index against the plain one.
- **Criterion A is in the report.** Each comparison now also has `fully-correct`, `citations-hold` and `not-wrongly-refused`, the values the dashboard computes for those rows.
- **Ten more rerank calls.** Retrieval scores 40 questions, and answers also cover the 5 the docs do not answer, each with a call per row. These were not among the calls made before any number was read, so that rule held for 80 of 90 calls. This was found while planning the answers. A rejection on one of the ten would still stop the run and go to the owner, now with numbers already read.
- **Noise.** Rows 3, 4 and 5 answer twice. The judge gives a second opinion on row 3 alone, as in M4, which is in the cache. Rows 4 and 5 add no such calls, so the estimate above holds.
- **The labels.** 15 answers, 7 from row 4 and 8 from row 5, with 3 on questions the docs do not answer, none on the same question twice, from a seed of their own, with all three dimensions to label: `drl eval label <report> --rows 4,5`, then `drl eval calibrate <report> <labels> --rows 4,5`. The latest blind round under the same prompts decides (ADR-0012), so a miss marks the judge uncalibrated for every report under those prompts.

### Result of the answers

Measured on 2026-11-04, in `eval/reports/typescript/2026-11-04-a5189068-m5-answers`. **Rows 4 and 5 pass A, and H3 and H4 stay not accepted, since T failed. A significant retrieval gain did not reach answer quality on this set.**

| Of 40 questions, first run / second run | Row 3, hybrid | Row 4, rerank | Row 5, rerank with contexts |
|---|---|---|---|
| Fully correct, may run high | 34 / 34 | 36 / 36 | 37 / 37 |
| All citations hold | 33 / 38 | 36 / 33 | 33 / 34 |
| Wrongly refused, fewer is better | 2 / 2 | 1 / 1 | 0 / 1 |
| Cites the right passage | 36 / 36 | 38 / 38 | 38 / 38 |
| Correct and grounded, exploratory, may run high | 28 / 32 | 32 / 29 | 29 / 30 |
| Refused rightly, of 5 | 5 / 5 | 5 / 5 | 5 / 5 |
| Cost per answer | $0.0225 / $0.0225 | $0.0229 / $0.0228 | $0.0230 / $0.0229 |
| Time per answer, retrieval not included | 4.7 s / 4.4 s | 4.7 s / 4.3 s | 4.7 s / 4.6 s |

Compared question by question, first runs, with the first row's count first:

| Comparison | Fully correct | All citations hold | Not wrongly refused | Correct and grounded |
|---|---|---|---|---|
| Row 3 against row 4 | 1 / 3, p = 0.63, noise | 4 / 7, p = 0.55, not significant | 0 / 1, noise | 3 / 7, p = 0.34, not significant |
| Row 3 against row 5 | 0 / 3, p = 0.25, not significant | 5 / 5, noise | 0 / 2, noise | 4 / 5, noise |
| Row 4 against row 5 | 0 / 1, noise | 6 / 3, p = 0.51, not significant | 0 / 1, noise | 6 / 3, p = 0.51, not significant |
| Row 3 against itself | 0 / 0 | 0 / 5, p = 0.06, not significant | 0 / 0 | 0 / 4, p = 0.13, not significant |
| Row 4 against itself | 0 / 0 | 4 / 1, p = 0.38, not significant | 0 / 0 | 4 / 1, p = 0.38, not significant |
| Row 5 against itself | 0 / 0 | 2 / 3, noise | 1 / 0, noise | 2 / 3, noise |

- **A: passed by both rows.** Row 3 is ahead by no question net on any of the three, and no verdict names it.
- **Correct and grounded: moved by neither row.** No verdict names a row, and a margin would have to pass 10, twice the larger run-to-run count of 5.
- **Row 5 shows nothing over row 4,** in line with the retrieval result.
- **Why retrieval's gain stayed there is a reading, not a test.** Claude reads all eight chunks, so a rank within the eight may matter less than what is in them, and only 3 more questions got a primary anchor into them. The set has little room either way, with row 3 already at 34 of 40.

The judge, on 15 answers the owner labelled blind, 7 from row 4 and 8 from row 5:

| Dimension | Agreed | Kappa | 95% interval | Passed |
|---|---|---|---|---|
| Correctness | 11 of 12 | 0.82 | 65% to 99% | yes |
| Refusal | 15 of 15 | 1.00 | 80% to 100% | yes |
| Support | 11 of 12 | 0.63 | 65% to 99% | yes |

The judge stays calibrated for these prompts. Its lean remains: the one new correctness disagreement is the judge scoring 2 where the human scored 1, on ts-0028 in row 5, so all 4 across the blind rounds go the same way, and correctness may run slightly high. The three questions the docs do not answer agree on 3 of 3, which is too little to decide anything.

Integrity:
- **Check 7 passed.** All 1,087 cited texts in rows 4 and 5 are in that chunk's original text, and none comes from a context. The comparison ignores whitespace, since a citation that spans blocks of a search result loses what separated them.
- **Check 6 passed for this report too:** `drl eval verify` says byte for byte, at its own commit.
- **Rows 0, 2 and 3 equal M4's final report** in every answer, verdict and support entry, from the cache, and all 160 scored answers of rows 4 and 5 read the context their retrieval report says.
- **Check 3 passed again,** at the end, and the plain index's sha256 is unchanged.

**What it took.** Claude came to $6.89 for this run and $0.66 for a pilot of 10 questions, against an estimate of $7.40, so about $7.83 in all with the contexts, under the $15 rule. The ten extra rerank calls were accepted with no 429: the cache holds 90 calls and 930,327 tokens, with no retry in any.

**The working tree moved during this run.** At 15:26:11, five minutes in, GitHub Desktop's branch list switched the working tree from this branch to `main`, by its own log. The report's commit had been stamped by then and its code was already loaded, and the checks above show the run was unharmed. ADR-0010 now has a guard for this.

### The app stays on hybrid

The owner first decided to switch the app to rerank as a product decision, apart from the verdict, and after these answers decided against it. **A significant retrieval gain that did not reach answer quality on this set does not justify a rate-limited dependency in the chat path.** So hybrid stays the app's default, and no ADR or PR switches it. Rerank becomes an on-demand comparison in the inspector, as planned for "what the reranker changed".

- **It is a comparison, not a method.** The inspector's Reranker tab has a button, "Compare with rerank", which makes one call through `/api/search` and shows where each of the fused top 20 would go and what crosses into or out of the top 8. The Hybrid and Vector toggle does not offer it, since the toggle also chooses the method for the next question. Neither the answer nor the next question changes.
- **The chat path refuses it in code.** `/api/ask` answers 400 to `strategy: 'rerank'`, so this holds beyond what the page offers. The CLI still takes it, since no chat waits on it.
- **A refused call says so where it was asked for.** The app says that Voyage did not take the call and to try again in a minute. It drops what a run is told to do on a rejection, since this is not a run.
- **It reads the plain index only.** The app has one index, so row 5 has no such comparison.
- **Checked live, at the owner's request.** On the real app, one uncached Compare under a doc type filter made one real call: 10,725 billed tokens, in 359 ms, with no 429. Its query vector was cached, so that was the only Voyage call, and the answers in that check were stubbed, so no Claude call was made. `/api/ask` refused the strategy, and the next question stayed on hybrid. The cache now holds 91 calls.

## Estimates

Made from the index and from M4's recorded costs, with no API call. Prices were checked again on 2026-11-03.

| Item | Estimate |
|---|---|
| Haiku 5.5, 994 contexts, with prompt caching | $0.20, up to $0.30 at 300 tokens out per chunk. $0.62 without caching |
| Voyage embeddings, 490K to 575K tokens | 59 to 69 minutes on the free trial, at M4's measured pace |
| Voyage embeddings of the control, about 430K tokens | 50 to 60 minutes, and no Claude |
| Voyage rerank, two passes, about 935K tokens | 45 to 55 minutes per pass |
| Rows 4 and 5, answers and judge | $3.70, at $1.85 per row as M4 measured |
| A second run of both rows | $3.70 |
| **Claude, in all** | **about $7.60**, or about $11.30 if H5 passes |

Voyage's tokens stay inside the 200M free tokens per model, and without a payment method there is no bill. Prompt caching is used for contexts only: in answers the context differs per question, so it would not hit, and it would change the requests M4's rows are cached under.

**The rule to stop.** Any command that spends prints its estimate first and waits for `--yes`. If the forecast for M5 passes $15 after a pilot, stop and ask.

## Alternatives considered

- **A payment method on Atlas.** It would end the waiting and the batching. The owner has decided against it.
- **Splitting each top 20 under the limit.** It would stay under 10K a minute for every call, but the batching check shows that a question's scores would then come from different sets.
- **A smaller depth from the start.** It would fit the limit, but the SPEC says 20, and it loses reach. It is the fallback, at 15, if Voyage rejects calls.
- **Contexts in the existing index, with a toggle.** It would change `chunksHash`, and M4's reports could no longer be verified.
- **Passing the contexts to Claude,** as Anthropic's write-up recommends. Native citations quote what Claude receives, so they could quote generated text.
- **Contextual alone as a ladder row.** The ladder in the SPEC is unchanged. It is measured so that H4 can be read, and it has no answers.
- **Contexts only in `data/`.** A clean clone could not rebuild the index without Haiku, and would get other text.
