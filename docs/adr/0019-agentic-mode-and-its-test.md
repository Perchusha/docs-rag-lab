# ADR-0019: Agentic mode, and what M9 tests

- Status: accepted as the test, before any agentic code, row 6 answer or paid call exists. PR 2 corrected how row 6 reproduces, which `drl eval verify` does not cover, and what its markdown quotes, as "What PR 2 built" says, before any answer of row 6. The pilot fixed where a search's note goes, as "What the pilot found" says. The test did not change. **H does not hold:** "What came out" has the result.
- Date: 2026-11-09
- Milestone: M9

## Context

SPEC section 9 gives Claude a `search_docs` tool, lets it search several times, and compares that with single-shot retrieval. M4 left a candidate for it (ADR-0012): on ts-0024, retrieval misses, so the grounded answer refuses while Claude without docs answers correctly.

M9 runs under ADR-0015 section 6: one main hypothesis with set-level criteria written down before any paid run, measured on the frozen sets only, TypeScript's version 3 (`8d6262de99f5`) and React's version 2 (`099ca3b20cb0`), with no new questions. The calibrated judge is reused, and a spot check of 10 answers runs only if the answer format changes in a way the judge has not seen. M9 aims for 3 to 4 PRs.

The owner set the brief on 2026-11-09:
- the agentic loop uses prompt caching, since each step resends a growing shared prefix, and cache writes and reads are counted separately;
- ts-0024 and the other questions where hybrid retrieval missed are motivating cases, but the whole set decides;
- the cross-lingual open item is a secondary note, not a second hypothesis.

The owner approved the plan the same day, with five decisions:
- **the hypothesis is decided on both sets together;**
- **row 6 starts from row 3's search** and adds at most 2 searches of its own;
- **the docs apps get an opt-in agentic chat whatever H's result,** and one search stays the default unless H holds;
- **the interview agent moves to after v1.0;**
- **M9 has a limit of $10 of Claude.**

**What the committed reports say, read with no API call.** Row 3 is hybrid on the plain index, the docs apps' default. Its first answers are fully correct on 41 of TypeScript's 48 answerable questions (`2026-11-06-14745976-m7-regraded`) and on 13 of React's 16 (`2026-11-05-8dfcae6f-m6`). Its second answers differ from its first on whether they are fully correct on 1 question in each. All of its 146 answers on the two sets finished. On the 9 questions the docs do not answer, it refused correctly in both runs, with no hallucination.

## Decision

### 1. Row 6

Row 6 is ladder row 6 of SPEC section 10.

- **The same answerer as row 3:** `models.answer`, Sonnet 5.5, with `answer`'s effort (low) and token limit, on the plain index. A higher effort would also change how the answer is written, so a difference could not be put down to the searches.
- **Its first request is row 3's request,** the 8 hybrid results for the question and then the question, with the tool and row 6's system prompt. The first search is the same as row 3's by construction. The only difference between the rows is that Claude may search again.
- **`search_docs`** takes a `query` and, optionally, `docTypes` from the source's own list, under a strict schema. It returns hybrid's top 8 for that query on the plain index, as `search_result` blocks in the same form as row 3's, with citations on. Chunks already in the conversation are left out, so a search may return fewer than 8. When none is new, the result says so. Its description says that the docs are in English, which is a fact about the corpus.
- **At most 2 searches of its own,** one per step, in `agentic.maxSearches` in `packages/settings`. The last search's result says that no search is left. A later call gets an error result. An answer that has not ended one step after that is recorded as failed, never as a score.
- **The limit is said in a tool result,** not by changing `tool_choice` or removing the tool. Either change drops the cached conversation, and removing the tool drops the whole cache.
- **The system prompt** keeps row 3's rules: use only the search results, say so when they are not enough, keep the answer short and direct, and include code only from the results. It adds two rules: when the results do not hold what the question asks, search again with a different query; and do not describe the searches in the answer. The exact text is in code, and its hash is in the report, like every prompt's.
- **The answer is the text of the last message.** The API numbers search results across the whole request, the first message's and every tool result's, in order. So each citation maps to a chunk, and the claims are checked as in rows 2 to 5.
- **Each step is cached in the eval cache by its own request** (ADR-0010), and the vectors of the agent's queries are cached in the embedding cache. A finished run of the loop is kept whole too, timed with its searches. So the same `drl eval answers` command, run again, replays row 6 with no call, as it does every row.
- **Row 6 answers twice under `--noise`,** like rows 3, 4, 5 and 7. A second answer's first request is the same as its first answer's, so the second answers start 6 minutes after the last first answer ends, when every cache entry of the first answers has expired. No answer then reads another's cache entry.

### 2. Prompt caching

Each step resends the system prompt, the tool and everything so far. Every request of row 6 asks for automatic caching: a top-level `cache_control`, with the 5-minute lifetime. Step n then reads what step n - 1 wrote, and writes only what it added. The first prefix is about 9,100 tokens: row 3's 8,600 and about 500 for the tool and the prompt. That is far above Sonnet 5.5's minimum of 512.

**The prices** are the ones in `packages/settings`, which match the pricing page on 2026-11-09. For Sonnet 5.5, per million tokens:
- input $2;
- a 5-minute cache write $2.50, 1.25 times input;
- a cache read $0.10, 0.05 times input;
- output $10.

**Caching does not pay on every answer:**
- **The first step's write pays only if a second step reads it.** It costs a quarter of input on top, about 2,300 input-token equivalents. On a one-step answer that is about 20% more than with no caching.
- **A second step saves about 4,400 equivalents net.** It reads the prefix for 0.95 of input less, about 8,600 equivalents. The first write and its own write of the new results come off that. Its own write is never read, if it is the last step.
- **So caching from the first step pays if about one answer in three searches again, or more.** The run measures this, and it is not assumed.

**What the report records:**
- for each answer: the input that was not cached, the cache writes, the cache reads and the output, in tokens, and the steps and searches with their queries, in the report's JSON;
- for each row: the same sums and their cost;
- the cost of the same tokens with no caching, writes and reads at the input price;
- the share of answers that searched again;
- the lapses: steps after the first that read nothing cached although the step before wrote, as when a search waits more than 5 minutes for Voyage's rate limit.

**Row 3 does not change.** Its requests stay byte for byte as they are, so its answers and verdicts come from the eval cache, and caching cannot touch the comparison.

**Caching decides nothing about H.** If it costs more than it saves, the owner is told before PR 4, whose chat would otherwise send the same requests.

### 3. The hypothesis

**H: when Claude can search again, grounded answers are fully correct more often than after one search.**

Row 3 against row 6, on fully correct, over the answerable questions of both sets together: TypeScript's 48 and React's 16, 64 in all. The first answers decide.

**H holds if both of these hold:**
1. **Fully correct.** The exact sign test over the 64 names row 6, with p below 0.05. Its margin, row 6's questions ahead less row 3's, passes twice the larger run-to-run count of the two rows, ADR-0013's rule. A row's run-to-run count is the number of the 64 questions on which its two answers differ on fully correct. Row 3's is 2.
2. **The guards.** By the same rule, no verdict names row 3 on all citations hold or on not wrongly refused. Each pair is formed as in each report, over both sets.

**An answer that is not ok,** failed, cut off or refused, counts as not fully correct in the comparison over 64, and is named. A report leaves such a question out of its own comparisons, which would help the side that failed. All of row 3's answers are ok.

**Any hallucination of row 6 on the 9 questions the docs do not answer is named,** even within noise. They are too few for a verdict, and an agent that searches until something turns up is exactly that risk.

**Each source is reported on its own too,** with the reports' usual verdicts. Their numbers are never compared with each other (ADR-0015). Putting both sets in one test adds their questions, and compares nothing.

**If H holds, the work stops,** and the owner decides whether the chat's default becomes agentic (section 7).

### 4. Its ceiling, written down first

From the committed reports, with no API call:
- **Only 10 of the 64 questions can move up.** Row 3's first answers are not fully correct on 7 of TypeScript's 48 (ts-0017, ts-0022, ts-0024, ts-0027, ts-0038, ts-0039, ts-0053) and on 3 of React's 16 (react-0002, react-0011, react-0015).
- **H needs at least 6 of them with no loss.** The smallest significant splits are 6:0, 8:1 and 10:2. Row 6's own run-to-run count can raise the bar: with 3 questions that differ, the margin must pass 6.
- **Of the 10:**
  - 6 are retrieval misses, where hybrid's top 8 lacks an anchor the answer needs: ts-0022, ts-0024, ts-0027, ts-0038, ts-0039 and react-0011;
  - 2 are where row 3 differs from itself: ts-0053 and react-0015;
  - 2 are not about retrieval, since hybrid ranks their anchor first: ts-0017, where every row scores 1, row 0 included, and react-0002, whose answer needs the API's documented status (ADR-0016).
- **Neither set alone could show H.** React has 3 questions that can move, below 6:0. TypeScript has 7, and would need 6 of them, so at least one of ts-0017 and ts-0053, which are not retrieval misses. That is why the owner decided on both sets together.

So H can hold only if a second search fixes nearly every retrieval miss and costs nothing elsewhere. If it does not hold, M9 still measures what agentic mode fixes, what it costs and whether caching pays.

### 5. Reported, and deciding nothing

**The motivating cases.** For each of these the report gives the agent's queries in its JSON, and in its markdown the steps and searches, whether a primary anchor was in the first search and whether one reached the chunks it read, and the scores of rows 3 and 6. They suggested the idea, so they cannot be its evidence, as ADR-0014 said of H5. The whole set decides.

| Question | What it asks | Hybrid's rank of a primary anchor | Row 3, both runs | Row 0 |
|---|---|---|---|---|
| ts-0024 | `String` or `string` in a declaration file | 40 | 0, refuses | 2 |
| ts-0022 | why `import "./foo.js"` for `foo.ts` | 15 | 1 | 2 |
| ts-0027 | what `strict` enables | 1, with 3 of its 4 required anchors below the top 8 | 1 | 2 |
| ts-0038 | which defaults changed in TypeScript 6.0, in Russian | 17 | 0, refuses | 0, refuses |
| ts-0039 | whether side-effect imports are checked by default | 13 | 0 | 0 |
| react-0011 | how `useState` knows which state to return, in Russian | 11 | 0, refuses | 2 |
| react-0007 | which API makes a component client-only | 17 | 2, from an acceptable passage | 0, refuses |

**Also reported:**
- each source's own verdicts, row 3 against row 6, on every answer metric;
- row 0 against row 6 on fully correct: whether searching again closes the gap to Claude's memory;
- correct and grounded, which stays exploratory (ADR-0012);
- on how many questions a primary anchor reached the chunks row 6 read, against row 3's hit@8, counted with no call;
- the cost and the caching of section 2, the steps, and the latency, which includes waits for Voyage's rate limit.

### 6. The cross-lingual note

8 questions are in Russian: ts-0004, ts-0016, ts-0023, ts-0038 and react-0005, react-0011, react-0012, which have answers, and ts-0042, which the docs do not answer.

- **Row 6's first search is the Russian question,** as row 3's is.
- **The report keeps each query of the agent's own in its JSON, and its markdown counts those written in Cyrillic.** The markdown quotes no query, since it quotes neither the docs nor Claude (ADR-0010). It also shows whether such a search brought in a primary anchor that the Russian question's search left out, as that search did on ts-0038 and react-0011.
- **They are too few for a verdict, and nothing is decided by them.**
- **The note bears on two open items:**
  - M6's: keyword search pushes the right chunk down on some Russian questions, and skipping it when the languages differ was a candidate;
  - M8's: the interview grader's keyword search reads a Russian answer.

### 7. The docs apps

PR 4 adds agentic mode to the chat of the ts-docs and react-docs apps, whatever H's result:
- it is opt-in, off by default;
- each search shows with its own trace in the inspector;
- it uses row 6's loop and caching;
- an Ask costs more and takes longer, and the app says what each Ask cost, as it does now.

**One search stays the default unless H holds.** If H holds, the owner decides on the default before anything changes it. On Voyage's free tier, a search of the agent's own waits for its slot, 3 requests a minute.

### 8. The judge

- **The judge does not change:** the same model and prompts.
- **What it reads has the same form as in rows 2 to 5:** the question, the answer's text, its claims and the passages they cite. It never sees the queries. So there is no spot check (ADR-0015 section 6).
- **The pilot may change row 6's prompt once,** if its answers describe their searches or the loop does not keep to section 1. The change and its reason are recorded here, and the pilot runs again.
- **If the answers still have a form the judge has not seen,** the owner labels 10 of row 6's answers blind, from a seed, before any judged number is read. It passes with at most one disagreement on each dimension it compares, as in ADR-0016 and ADR-0017.

### 9. Not in M9

- **The interview agent,** with `search_docs`, `get_progress` and `record_score`, moves to after v1.0, by the owner's decision. It would be judged by use, not on the frozen sets, and M8's fixed loop has just shipped. This replaces what ADR-0018 section 7 says of an agent with tools, and SPEC sections 11 and 13 say so.
- **New questions, a change to a frozen set, or a change to the judge.**
- **Rerank or contexts under the agent:** the chat stays on hybrid (ADR-0014), and row 6 reads what the chat reads.

## What stops the work

A pilot comes first. It takes 5 TypeScript questions by rule, the first in id order of the `basic`, `edge`, `cross-lingual` and `fresh` tags and the first the docs do not answer: ts-0001, ts-0005, ts-0004, ts-0036 and ts-0041. It shows whether the loop keeps to section 1, and it replaces the estimate with measured tokens. Its answers are cached, so the full run pays for them once.

The work stops, and the owner is asked, if:
- **the forecast for M9 passes $10** of Claude;
- **row 3's answers or verdicts would be paid for,** which means its requests changed;
- **an integrity check fails;**
- **Voyage rejects a call,** by ADR-0014's rules;
- **the spot check of section 8 runs and misses;**
- **H holds.**

## Integrity checks

These come first. If one fails, the numbers are not read as a result.

1. **Every named report keeps reproducing as it does today.** Before PR 2, `drl eval verify` runs on each named report of both sources and records which say byte for byte. After each PR that changes shared code, and at the end, the same ones say so again.
2. **The indexes stay as they are.** On 2026-11-09 their sha256 starts as follows: the plain index `403465a8`, the contextual `9ceab39b`, the control `77aa7643`, the compiled `f4d1f402`, and React's `019e2afd`.
3. **What the dashboard builds is unchanged** for every report, against a snapshot taken before PR 2, apart from what a PR says it adds.
4. **Row 3 is unchanged:** the estimate shows no paid call for row 3's answers or verdicts on either set.
5. **This test comes first:** the commit that adds this ADR is an ancestor of the commit every M9 report stamps.
6. **M9's reports reproduce.** `drl eval verify` says byte for byte on their retrieval. Their answers are not its subject (ADR-0010): the same `drl eval answers` command, run again, replays row 6 from the cache with no call and gives the same answers.
7. **Every cited text is in its chunk's text,** as ADR-0014's check 7.

## Estimates

From M6's and M7's measured costs, with no API call: about $0.021 per row 3 answer at about 8,600 input tokens, and about $0.019 for the judge per answer.

**Row 6, per answer, with caching:**
- about $0.028 if it answers at once: the first prefix written, and about 500 tokens of answer;
- about $0.05 with one search of its own: the prefix read, about 8,000 tokens of new results written, and the answer;
- about $0.075 with two.

| Item | Estimate |
|---|---|
| Row 6, 73 questions answered twice | about $5.50, at $0.035 to $0.04 an answer; about $11 if every answer searched twice |
| The judge on row 6's 146 answers | about $3 |
| Row 3's answers and verdicts | none, from the eval cache |
| **Claude, in all** | **about $8.50,** with a limit of $10 |
| Voyage embeddings | one request per search of the agent's own, paced at 3 a minute: 25 to 40 minutes, inside the free tokens |
| Voyage rerank | none |

The pilot's forecast decides, and a run stops before its next call at the limit, with what it paid for kept in the cache.

## The PRs

1. **This ADR,** and SPEC sections 9, 10, 11 and 13. No code.
2. **The loop and row 6, with no paid call:**
   - `contracts`: row 6, and the answer's steps, queries and cache tokens as optional fields, so that earlier reports keep their bytes;
   - `settings`: `agentic.maxSearches`;
   - `core`: the loop and the tool, row 6 in eval, and the cache columns of the report;
   - `cli`: `drl ask --agentic`, `--rows 6` for `drl eval answers`, and `drl eval pool`, which computes section 3's test over the two reports with no API call.
   - Tests on fixtures. No new dependency.
   - The dashboard's view of a report with row 6, in `core`.
3. **The runs:**
   - the pilot, then both sets, and the test of H;
   - the reports and their verify records;
   - the README, the journal, SPEC and CLAUDE.md's commands;
   - the code-reviewer subagent.
4. **The docs apps' agentic chat,** section 7: `docs-server`, `ui`, the NDJSON event in `contracts`, and the stories.

## What PR 2 built

Before any answer of row 6, with no paid call:
- **The loop** is `core`'s `runAgentLoop`, which row 6, `drl ask --agentic` and PR 4's chat share. A tool result holds the new chunks as `search_result` blocks, then one line on what was left out and how many searches are left. A call after the last search gets an error result, and a further one ends the answer as failed. Whatever it calls, an answer makes at most `maxSearches + 2` requests: the first, one per search and one after the error.
- **Each step's citations are checked** against the chunk the loop's list puts at their index, by the source and title it was sent with: ADR-0014's check 7 done in code, before anything is stored. A numbering other than the one section 1 takes from the API would fail the answer instead of mapping its citations to other chunks.
- **`drl ask --agentic` shows only the answer's own step,** as only it is scored: a step that asks for a search keeps whatever text it had to itself, so the answer arrives when its step ends.
- **Row 6's first request** is row 3's, with `AGENT_SYSTEM_PROMPT`, `search_docs` under a strict schema with the doc types the index holds, `disable_parallel_tool_use`, and a top-level `cache_control`. Its tool's description and the prompt are hashed in the report, as `agent` and `agentTool`.
- **A run of the loop is kept whole** in the eval cache, with the time it took, searches and the wait for Voyage included. It is kept under the first request, the loop's version, a hash of every text its steps send besides the search results, the limit, and what decides its searches: the retrieval settings and the plain index's chunks and vectors. Rewording a tool result, or syncing the index again, makes a new run. The report records all four as `agentic`. Each step is kept by its own request too, under the kinds `agent-first` and `agent-step`, so a run that stopped pays only for the rest, and the estimate learns from them how often Claude searches.
- **A search that fails stops the run,** as a rejected Voyage call does under "What stops the work". The steps already paid for stay cached.
- **The estimate** counts each first request, tool included, for free, and prices the prefix written once, each search read and written, and each step's output. Until 5 runs are cached it assumes one search in two answers, and it prints what the answers would cost if each used every search.
- **The second answers** start after a wait of 6 minutes, and only when one of their first requests is not cached.
- **The report** adds, for row 6, each step's tokens, the searches, and the cost with and without caching, and per row the searches, steps, cache writes and reads, lapses, first steps that read the cache, and how often a primary anchor was in the first search or reached the conversation. Its markdown shows these by question too, and counts the queries in Cyrillic.
- **`drl eval pool`** reads two reports or more and prints section 3's test. With `--name` it writes it under `eval/pooled/`, outside `eval/reports/`, whose folders are sources. It takes one report a source, answered and judged by the same models under the same prompts. A guard no report could compare is left out, as for row 0, which cites nothing. H does not hold while a row answered twice by design lacks its second answers in some report, since the bar its margin must pass is then unknown, or while a first answer has no verdict; each such answer is named. Run on TypeScript's `m7-regraded` and React's `m6` with `--rows 0,3`, it read both with no API call.
- **The dashboard** shows a report with row 6 as row 3 against row 6, each with its own run to run, and says that one search stays the chat's default unless this test, over both sources, holds.
- **The code-reviewer subagent read PR 2 before it opened.** Its findings are fixed above: an unknown run to run that let the bar fall to the other row's, unjudged answers that went unnamed, no hard cap on requests, a stored run's key that missed the tool results' texts and the index, the unchecked numbering of citations, a searching step's text shown in `drl ask`, no test of a resumed run, and a failed search that did not stop the run.
- **Integrity checks 1 and 3:** before PR 2, `drl eval verify` said byte for byte on 14 of the 19 named reports, and "not comparable" on the 5 whose retrieval code lives at tags of their own: `m4-control`, `m4-h1`, `m4-h2`, `m4-h1-h2` and `m5-h5`. What the dashboard builds for every report was snapshotted then, and is unchanged at the end of PR 2.

## What the pilot found

The pilot answered its 5 questions on 2026-11-09, at loop version 1.
- **The API refused the one search.** It answered ts-0041 with a 400: "if any blocks in a tool result are of type `search_result`, all blocks must be of that type". The note on what a search left out and how many searches are left was a text block in that tool result.
- **The fix, in `0e62962`.** The note now follows the tool results as a text block of the same message. A search with nothing new keeps its note in its tool result, which then holds only text. The loop's version went to 2, so no run stored at version 1 is read.
- **The prompt did not change.** The pilot ran again on the same 5 questions with the fix.
  - **Answerable questions.** The 4 that the docs answer did not search again: a primary anchor was in their first search. Each cost about $0.028, against $0.024 without caching.
  - **ts-0041.** It searched twice, refused correctly, and cost $0.048, against $0.078 without caching. Each step read what the step before wrote, with no lapse.
- **One answer described its search.** ts-0041's answer says, in its second sentence, "The documentation I searched is the TypeScript docs". Row 3's refusals say the same of their search results, in the same place, so the judge reads no new form, and there was no spot check (section 8). In the full runs, several of row 6's refusals describe their search the same way, and the same reading covers them.
- **The pilot paid $0.25,** $0.22 of it in the first try.

## What came out

The reports are [TypeScript's](../../eval/reports/typescript/2026-11-09-0e629627-m9.md) and [React's](../../eval/reports/react/2026-11-09-bb8cc039-m9.md). The test over both is [`eval/pooled/m9`](../../eval/pooled/m9.md). No stop was hit: the forecast was $8.12, $5.81 for TypeScript and $2.06 for React with the pilot's $0.25. Voyage rejected nothing, and the judge read no new form.

| Over both sets, first answers | Row 3, one search | Row 6, agentic |
|---|---|---|
| Fully correct, of 64, may run high | 54 (74-91%) | 53 (72-90%) |
| Run to run on fully correct | 2 | 4 |
| All citations hold, of 64 | 54 | 51 |
| Wrongly refused, of 64, fewer is better | 4 | 1 |
| Hallucinations, of 9 the docs do not answer | 0 | 0, and 1 in its second answers |

**H does not hold.**
- **Fully correct.** Row 3 is ahead on 3 questions and row 6 on 2, with 59 tied: p = 1, which is noise. Row 6 differs from itself on 4 of the 64, so even 6 to 0 would not have passed the bar of 8.
- **The guards name neither row.** All citations hold is 10 to 7 for row 3, not significant. Not wrongly refused is 0 to 3 for row 6, not significant.
- **Each source alone says the same.** TypeScript is 2 to 1 for row 3 and React 1 to 1, both noise.

**Where the second search helped and where it did not:**
- **Row 6 searched again on 9 of the 64 answerable questions** in its first answers, and on all 9 the docs do not answer.
- **Of the 6 retrieval misses of section 4, it searched on 3, and a primary anchor reached each. 2 of them became fully correct:**
  - ts-0024 went from 0, a refusal, to 2 in both answers. Its query named the page, Do's and Don'ts.
  - react-0011, asked in Russian, went from 0, a refusal, to 2 in both answers.
  - ts-0038, asked in Russian, went from 0 to 1.
- **On the other 3 it answered from the first search,** and nothing changed: ts-0022 and ts-0027 scored 1, and ts-0039 scored 0. Claude did not notice what the first results lacked.
- **What it lost is within its own noise.** On ts-0047, ts-0051 and react-0001, row 6's first answer scored 1 where row 3 scored 2, and its second answer scored 2 on all three. ts-0047 and ts-0051 ask what an error code means, and on those Claude searched for the message text, which the plain chunks do not pair with its code, as M7's compiled index does.
- **A primary anchor was in the first search on 58 of the 64,** and reached the conversation on 61.

**The one hallucination** is in row 6's second answers, which the test does not read, and the docs do say what it claims.
- **What the answer did.** On ts-0044, an option that does not exist, it refused correctly. Then it said that TypeScript 4.3 and 5.4 tightened enum checks, and cited neither.
- **The passages were in its conversation.** Its own search for `strictEnumChecks` had returned the 4.3 and 5.4 release notes that say so.
- **Why the judge called it a hallucination.** The judge reads only cited passages, so it took the claim as outside knowledge.
- **The first answer did the same, with citations.** It made the same kind of claim, on 5.0 and 5.4, cited those two passages, and was graded a correct refusal.
- **What this shows about the judge.** An uncited claim drawn from a passage the conversation holds reads to it as a hallucination. That is an open item.

**Caching came out even, as section 2 expected when fewer than about one answer in three searches again:**
- **How often row 6 searched again:** 34 of its 146 answers (23%) searched again, and no step lapsed or read another answer's entry.
- **What it cost, over both answers of both sets:** row 6 paid $4.434 at list prices, and the same tokens with no caching would have cost $4.423.
  - On TypeScript, caching cost $0.031 more.
  - On React, it saved $0.019.
- **Where it pays:** a one-step answer pays a quarter more on its prefix, and an answer that searches twice saves about two fifths. It pays only for answers that search again.

**What row 6 costs and takes:**
- **Per first answer, over all 53 and 20 questions,** the 9 the docs do not answer included: $0.0315 on TypeScript and $0.0279 on React, against row 3's $0.0219 and $0.0195. That is 43% to 44% more. The reports' own tables, on the answerable questions alone, give $0.0303 and $0.0262, against $0.0222 and $0.0203.
- **Time on the first answers, over all questions:** 17.8 s on average on TypeScript and 15.6 s on React, against row 3's 4.4 s and 3.9 s. It splits by searches:
  - an answer that did not search again took about 4 s, as row 3's do;
  - one search took 53 s on TypeScript and 25 s on React;
  - two searches took 93 s and 90 s.

  That is mostly waiting for Voyage's free tier, 3 requests a minute, under 4 answers at once.
- **Time on the second answers:** 7.4 s and 3.8 s, with most query vectors already cached. On React's 16 answerable questions, row 6 took 3.9 s and row 3 4.3 s.

**The cross-lingual note (section 6).**
- **No query of Claude's own was in Cyrillic:** none of its 42 searches over both runs.
- **Russian misses:** on both Russian questions where row 3's search missed, ts-0038 and react-0011, its English query reached a primary anchor.
- **Russian questions it answered at once:** ts-0004, ts-0016, ts-0023, react-0005 and react-0012 had a primary anchor in their first search, and row 6 did not search again.

So on the two Russian misses, the agent's English queries did what M6's candidate, skipping keyword search when the languages differ, would have to do.

**Spend.**
- **Claude: $7.19** at list prices, against a limit of $10:
  - $0.25 for the pilot;
  - $5.18 for TypeScript;
  - $1.76 for React.
- **Voyage:** 30 embedding requests, the pilot's included, inside the free tokens.

**Integrity checks:**
1. **`drl eval verify`** gives the same on all 19 earlier named reports as before PR 2: 14 match byte for byte, and 5 are not comparable, as before.
2. **The indexes' sha256 are as recorded.**
3. **What the dashboard builds for every earlier report is unchanged.** Only the lists of runs gained the two m9 reports, which build.
4. **Row 3's answers and verdicts came from the cache,** as rows 0 and 2's did.
5. **This ADR's commit is an ancestor of both reports' commits.**
6. **Both reports reproduce.**
   - `drl eval verify --record` says byte for byte on their retrieval.
   - The same `drl eval answers` command, run again, paid nothing. It gave the same answers, verdicts, support checks, rows and comparisons; only which answers came from the cache differs.
7. **Every cited text of rows 3 and 6 is in its chunk's text,** whitespace aside: 722 citations of row 6 and 746 of row 3.

**A gap the TypeScript report shows.** Its list of cited chunks to review as anchors gives no document for two chunks that only row 6's own searches found, since a report's chunk table holds only its retrieval traces.
- ts-0040's chunk is in `handbook-v2/Basics.md`.
- ts-0047's chunk is in `release-notes/TypeScript 3.7.md`.

PR 3 looks such chunks up in the plain index, for later reports.

**What this decides.** One search stays the docs apps' default, and PR 4 adds the agentic chat as an option, as section 7 has it.

## Alternatives considered

- **Claude writes the first query itself.** That is closer to an agent with no help. But a loss on a question hybrid already answered would then have two causes, the first query and the second search, and the first search would cost a Voyage request of its own.
- **Deciding on each set alone.** Neither could show H (section 4).
- **Correct and grounded as the criterion.** It has more room, but it was defined after M4's results and stays exploratory (ADR-0012). Row 3's two runs differ on it on 4 of TypeScript's 48, so its noise bar would be high.
- **`tool_choice: none` at the limit.** A change of `tool_choice` drops the cached messages, so the last step would pay to write the whole conversation again.
- **The 1-hour cache.** Its write costs twice the input, and the steps of one answer are seconds to minutes apart.
- **A second breakpoint on the static prefix,** the system prompt and the tool, shared by every question of a source. It is about 600 tokens, near the 512 minimum, and would save about a tenth of a cent per answer.
- **Ranks below 8 instead of leaving out what was already shown.** A search would no longer be hybrid's top 8 for its query, which is what the inspector shows.
- **Several searches in one step.** That means fewer steps and fewer cache writes. But each search is one Voyage request at 3 a minute either way, and one search per step keeps the trace readable.
- **The interview agent in M9,** as SPEC section 11 had it. Moved to after v1.0 (section 9).
