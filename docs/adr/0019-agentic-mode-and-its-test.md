# ADR-0019: Agentic mode, and what M9 tests

- Status: accepted as the test, before any agentic code, row 6 answer or paid call exists.
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
- **Each step is cached in the eval cache by its own request** (ADR-0010), and the vectors of the agent's queries are cached in the embedding cache. So `drl eval verify` replays row 6 with no call.
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
- for each answer: the input that was not cached, the cache writes, the cache reads and the output, in tokens, and the steps and searches with their queries;
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

**The motivating cases.** For each of these the report gives the agent's queries, whether a primary anchor reached the chunks it read, and its score. They suggested the idea, so they cannot be its evidence, as ADR-0014 said of H5. The whole set decides.

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
- **The report records the language of each query of the agent's own.** It also records whether such a query brought in a primary anchor that the Russian question's search left out, as that search did on ts-0038 and react-0011.
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
6. **M9's reports reproduce byte for byte,** with every step of row 6 replayed from the caches.
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
3. **The runs:**
   - the pilot, then both sets, and the test of H;
   - the reports and their verify records;
   - the README, the journal, SPEC and CLAUDE.md's commands;
   - the code-reviewer subagent.
4. **The docs apps' agentic chat,** section 7: `docs-server`, `ui`, the NDJSON event in `contracts`, and the stories.

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
