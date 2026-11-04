# ADR-0014: Testing rerank and contextual retrieval

- Status: accepted as the test, before any run. The results come later, in this file.
- Date: 2026-11-03. Batching and the cache changed on 2026-11-04, after the batching check and before any run. The control row was added the same day, before any retrieval number existed.
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
