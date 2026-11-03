# ADR-0012: Answer metrics, the judge and its calibration

- Status: accepted
- Date: 2026-11-03
- Milestone: M4

## Context

Retrieval metrics say whether the right passage reached the answer, not whether the answer is right. SPEC section 10 asks for answer metrics only on request, with the cost printed first, cached so that a rerun does not pay twice, graded by an LLM judge that a human has checked. The API has no temperature for these models, so answers are not deterministic.

## Decision

### 1. Rows

Three rows of the ladder answer the set:

| Row | What it sends | Prompt |
|---|---|---|
| 0, Claude without RAG | The question alone | Its own: answer from memory, and say so if the docs would not cover this |
| 2, vector | Top 8 by vector search, with citations | The one the app uses |
| 3, hybrid | Top 8 by hybrid search, with citations | The one the app uses |

The model, effort and `max_tokens` are the app's, so a row measures what a user would get. Server fallbacks stay off, and an answer from another model than the one asked for counts as failed.

### 2. Nothing is a score by accident

An answer ends as `ok`, `truncated`, `refused` (a safety classifier, which is not the same as saying the docs do not cover it) or `failed`. Only `ok` is judged and counted, and the others are listed by question. An empty answer, or one that stops for any other reason, is `failed`. An API error is never a 0. A judge reply that is not valid output, or a false refusal scored above 0, is a failed verdict: it leaves the mean, the question is listed as not judged, and the command exits non-zero. A named report refuses to exist with anything failed.

### 3. Every call is cached by its whole request

The key is a hash of the whole request and a sample number, so a change to the question, the context, the model, the effort, `max_tokens` or a prompt is another request. A call is cached as soon as it returns with something usable, so a run that stops loses nothing, and a rerun picks up where it stopped. Failed calls and unusable replies are not cached, so a rerun tries them again. Identical requests at once get one call, so one text cannot get two grades. The report holds the raw text blocks with every citation, since the app's `CitationNumbering` keeps only the first passage per source.

`drl eval answers` prints an estimate and stops unless given `--yes`. Answer input comes from the free `count_tokens`, and output sizes from past calls of the same kind, or from stated assumptions until 5 are cached. An answer in the cache says exactly which judge calls it needs, so the estimate counts those too. A run refuses a forecast over its limit, $15 by default, and stops before the next paid call once it has spent that.

### 4. The judge

Opus 5.5 grades, so that the model does not grade its own answers. It sees no row and no strategy, and each prompt grades one thing through structured output:

- **Correctness,** 0 to 2, against the expert's answer, on what the question asks. A refusal scores 0 and is marked as a false refusal.
- **Refusals,** on a question the docs do not answer: `correct-refusal`, `hallucination` or `wrong`, by the owner's rule in ADR-0009. These never enter the correctness mean. This prompt also sees the citations, because a correct refusal cites nothing as support for an answer.
- **Support,** for each text block that cites something: could a reader confirm it from the passages alone? Only for answers with citations, on questions the docs answer.

Citation accuracy needs no judge: does an answer cite a chunk of a primary or acceptable anchor? When the judge finds that a cited chunk supports a correct answer and the chunk is not an anchor, the report lists it for review, and nothing adds it (ADR-0009).

Row 0 has no citations, so its answers can be told apart from answers that cite something. The correctness prompt does not show citations for this reason.

Two rows that give the same text share one verdict, because the request is the same. That is the blindness working.

`drl eval judge-check` grades answers whose grade is known before any run: the expert's own answer, an empty one, "I do not know", a confident answer to another question, a made-up fact, and citations that do and do not support their claim.

### 5. A human checks the judge

`drl eval label <report>` writes a sheet of 15 answers from a fixed seed: 5 per row, each with one unanswerable question and one the judge scored low, in shuffled order. The sheet shows no verdict and no row, and it goes under `dev/`, since it quotes Claude and the docs. `drl eval calibrate <report> <labels>` reports agreement per dimension, with Cohen's kappa and a 95% Wilson interval.

The sheet names its sample by a hash, and the labels file repeats it, so labels cannot be read against other answers. Every item needs one label. The bar is 13 of 15 on each dimension. Below it, or with nothing compared on a dimension, the answer metrics are marked uncalibrated.

Refusal agreement covers every answer, by the owner's rule: whether it refused, and whether that was right. So a refusal of a question the docs do answer is a disagreement like any other, and 13 of 15 means the same as on the other dimensions. The three outcomes on unanswerable questions alone, of which the sample has 3, stay on a separate line that says it is too little data and decides nothing.

The bar is a share, so what it allows depends on how many answers a dimension compares. The owner fixed this before any comparison:

| Dimension | Compared in this sample | Disagreements allowed |
|---|---|---|
| Refusal | 15, every answer | 2 |
| Correctness | 12, the questions the docs answer | 1 |
| Support | 8, the answers that cite something on questions the docs answer | 1 | The interval is there because 14 of 15 still means somewhere from 70% to 99%. If the judge's prompt changes after labelling, those 15 are no longer blind, and about 5 fresh ones are needed.

### 6. The second round, after the first missed the bar

The first round agreed on correctness on 10 of 12, one disagreement over what the bar allows. The owner set the following before any re-grading and before any fresh answer was picked.

**The rubric.** It already said 1 means part of what is asked is missing or wrong, so "minor gap, still 2" broke the written rule. The prompt now says so outright: if any part of what the question asks is missing or wrong, the score is 1, however small, and details the question did not ask for do not count either way. This aligns the judge with its rule. It is not tuned to the labels. Correctness is graded again, for every answer. The refusal and support prompts do not change.

**Fresh labels.** 10 fresh answers:
- only on questions the docs answer, and none on a question in the first 15, so no answer repeats and no question is seen twice;
- 3 from row 0, 3 from row 2 and 4 from row 3, from a second fixed seed, with at least 3 the re-graded judge scored low when there are 3, in shuffled order;
- at most 1 disagreement on correctness, the same tolerance as the first round. 5 of 5 would be both stricter and weaker evidence.

**What it decides.** The fresh round decides correctness alone. Refusal and support keep their first-round results. If it misses the bar, correctness stays marked uncalibrated, and the prompt does not change again without the owner.

**The first 15, graded again,** are reported apart and marked as not blind, because the prompt changed after those labels were read. They decide nothing.

### 7. Correct and grounded, exploratory

Defined after seeing the first results, so it is marked as exploratory wherever it appears, and it is no target. It takes no new LLM call. An answer is correct and grounded when it scores 2, every claim it cites is supported, and at least one cited chunk is a primary or acceptable anchor. Row 0 cannot score on it by design, so the metric shows what retrieval adds beyond Claude's memory.

### 8. Noise

Differences between rows use the same sign test and verdicts as retrieval (ADR-0010). Unlike retrieval, answers have run-to-run noise too. `--noise` answers row 3 a second time and asks the judge a second time about row 3's first answers, so a report says how far a row differs from itself and how often the judge repeats its grade. A difference between rows that a row also shows against itself means nothing.

## Measured

The report `eval/reports/typescript/2026-11-03-53f5eb82-answers`, at docs `205122bb` and set version 1, on 40 questions with answers and 5 without. It cost $6.67 at list prices with its pilot and known cases.

**The judge did not reach the bar, so its correctness scores are uncalibrated.** The labels are in `eval/labels/typescript/`.

| Dimension | Agreed | Kappa | 95% interval | Passed |
|---|---|---|---|---|
| Correctness | 10 of 12 | 0.71 | 55% to 95% | no |
| Refusal | 15 of 15 | 1.00 | 80% to 100% | yes |
| Support | 8 of 8 | 1.00 | 68% to 100% | yes |

Both disagreements are the judge scoring 2 where the human scored 1, and on ts-0038 the judge's own reasoning names a gap and still gives 2. It is stable: asked twice about 45 answers, it gave the same grade on all 45. So this is a lean, not noise.

| Row | Correctness | Scored 0 / 1 / 2 | False refusals | Cites an anchor | Claims supported | Refused correctly | Cost per question |
|---|---|---|---|---|---|---|---|
| 0, no RAG | 1.850 | 2 / 2 / 36 | 1 | - | - | 5 of 5 | $0.0043 |
| 2, vector | 1.875 | 2 / 1 / 37 | 1 | 35 of 40 | 241 of 243 | 5 of 5 | $0.0216 |
| 3, hybrid | 1.775 | 3 / 3 / 34 | 2 | 36 of 40 | 236 of 244 | 5 of 5 | $0.0225 |
| 3, again | 1.775 | 3 / 3 / 34 | 2 | 36 of 40 | 231 of 234 | 5 of 5 | $0.0225 |

- **Row 2 against row 3, correctness:** row 2 is better on 3 questions and row 3 on none, with 37 tied: p = 0.25, not significant. All three are questions hybrid search handles worse: ts-0022 and ts-0038 miss the top 8, and ts-0027 is the unmet target.
- **Row 2 against row 3, support:** 7 to 0, p = 0.016, which the verdict calls better. Row 3's second sample scores 0.990 against row 2's 0.994, 2 to 0, and row 3 differs from itself by 1 to 5. So this is run-to-run noise that one test cannot see, and it is not a difference between the rows.
- **What correctness cannot see:** on ts-0035 and ts-0040, vector search misses the anchors and the answer still scores 2, citing no anchor. On ts-0040 it says that the search results do not define the error, and reasons from one example. Row 3 cites an anchor on both.
- **Row 0 against row 3:** 3 to 1, noise. This set does not separate no RAG from RAG on correctness, since Claude knows much of it from memory, and row 0 cites nothing.
- **Noise:** row 3 against itself ties on correctness on all 40 questions, so these differences are not the answers varying.

## Consequences

- A report with answers is larger, because it holds the answers. Only named runs are committed.
- The markdown never quotes Claude or the docs. The labelling sheet is the one exception, and git does not see it.
- `drl eval verify` ignores the answers section, since answers do not repeat.

## Alternatives considered

- **Sonnet 5.5 as the judge.** Cheaper, but the model would grade itself.
- **The Batch API.** About half the price, but it loses latency and adds a second path for requests.
- **Asking the judge everything in one prompt.** Support needs the passages and correctness must not depend on them, so they stay apart.
- **Asking for confirmation at a prompt.** `--yes` works in scripts and tests, and the estimate is printed either way.
