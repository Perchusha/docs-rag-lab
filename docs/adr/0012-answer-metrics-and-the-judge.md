# ADR-0012: Answer metrics, the judge and its calibration

- Status: accepted. ADR-0015 says when a new round of labels is needed.
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

`drl eval judge-check` grades answers whose grade is known before any run: the expert's own answer, an empty one, "I do not know", a confident answer to another question, a made-up fact, a status left out that a grading note asks for (ADR-0016), and citations that do and do not support their claim.

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

Differences between rows use the same sign test and verdicts as retrieval (ADR-0010). Unlike retrieval, answers have run-to-run noise too. `--noise` answers row 3 a second time and asks the judge a second time about row 3's first answers, so a report says how far a row differs from itself and how often the judge repeats its grade. A difference between rows that a row also shows against itself means nothing. ADR-0014 adds rows 4 and 5 to what `--noise` answers twice. The judge's second opinion stays on row 3.

## Measured

These numbers come from `eval/reports/typescript/2026-11-03-2184bccc-answers-regraded`, at docs `205122bb` and set version 1, on 40 questions with answers and 5 without. M4's final report, `2026-11-03-94474c83-final`, read every answer and verdict from the cache at a later commit, for $0.00, and reads the same. The first report, `2026-11-03-53f5eb82-answers`, stays as what the first round of labels was read against. All of it cost $8.20 at list prices, with the pilot, the known cases and the re-grading. The labels are in `eval/labels/typescript/`.

### The judge

**It is calibrated, by the rule fixed beforehand, with a lean that remains.** The owner accepted the calibration as passed, because the rule was fixed in advance. The residual bias is stated wherever correctness is reported: all three disagreements go the same way, so correctness may be slightly inflated.

| Round | Dimension | Agreed | Kappa | 95% interval | Passed | Decides |
|---|---|---|---|---|---|---|
| Fresh, blind, new prompt | Correctness | 9 of 10 | 0.80 | 60% to 98% | yes | yes |
| First, blind | Refusal | 15 of 15 | 1.00 | 80% to 100% | yes | yes |
| First, blind | Support | 8 of 8 | 1.00 | 68% to 100% | yes | yes |
| First, blind, old prompt | Correctness | 10 of 12 | 0.71 | 55% to 95% | no | replaced by the fresh round |
| First 15 graded again, **not blind** | Correctness | 11 of 12 | 0.86 | 65% to 99% | - | no |

Two things limit what this shows:
- **The lean remains.** All three disagreements across both rounds are the judge scoring 2 where the human scored 1: ts-0038, which the new prompt moved, ts-0023 and ts-0028. On ts-0028 the judge again names an overstatement in the answer and scores 2. So correctness may still run slightly high. It is stable: asked twice about 45 answers, it gave the same grade on all 45.
- **The new prompt did little.** It changed 1 of the 120 first-sample correctness verdicts, ts-0038 in row 2, from 2 to 1. The fresh round would have come out the same under the old prompt, so its pass reflects another sample of answers. It does not show that the prompt fixed the lean.

### The rows

Correctness below may be slightly inflated in every row, since all three disagreements with the human are the judge scoring higher.

| Row | Correctness | Scored 0 / 1 / 2 | False refusals | Cites an anchor | Claims supported | Refused correctly | Cost per question |
|---|---|---|---|---|---|---|---|
| 0, no RAG | 1.850 | 2 / 2 / 36 | 1 | - | - | 5 of 5 | $0.0043 |
| 2, vector | 1.850 | 2 / 2 / 36 | 1 | 35 of 40 | 241 of 243 | 5 of 5 | $0.0216 |
| 3, hybrid | 1.775 | 3 / 3 / 34 | 2 | 36 of 40 | 236 of 244 | 5 of 5 | $0.0225 |
| 3, again | 1.775 | 3 / 3 / 34 | 2 | 36 of 40 | 231 of 234 | 5 of 5 | $0.0225 |

- **Row 2 against row 3, correctness:** row 2 is better on 3 questions and row 3 on none, with 37 tied: p = 0.25, not significant. All three are questions hybrid search handles worse: ts-0022 and ts-0038 miss the top 8, and ts-0027 is the unmet target. Hybrid stays the default until M5, by the owner's decision.
- **Row 2 against row 3, support:** 7 to 0, p = 0.016, which the verdict calls better. Row 3's second sample scores 0.990 against row 2's 0.994, 2 to 0, and row 3 differs from itself by 1 to 5. So this is run-to-run noise that one test cannot see, and it is not a difference between the rows.
- **Noise:** row 3 against itself ties on correctness on all 40 questions, so these differences are not the answers varying.

### What this set can and cannot show

**On this set, row 0 is about as correct as RAG, so correctness alone does not measure the value of RAG here. What RAG adds is grounding.** Without any docs, Claude scores 2 on 36 of 40, and row 0 against row 2 is 1 to 2, noise. RAG can even cost something: on ts-0024, row 0 scores 2, and both RAG rows refuse because the anchor is not in the context. That is a candidate for M9, where a second, agentic search is the natural fix. Nothing in row 0 can be checked against the docs, which is what the metric below counts.

**Correct and grounded, exploratory:** defined after seeing the first results, and no target.

| Row | Correct and grounded, of 40 |
|---|---|
| 0, no RAG | cannot score, by design |
| 2, vector | 31 |
| 3, hybrid | 28 |
| 3, again | 32 |

Row 2 against row 3 is 5 to 2, p = 0.453, not significant. Row 3 against itself is 0 to 4, which is a larger swing than the gap between the rows, so this metric does not separate them either. The questions differ: row 2 alone is grounded on ts-0001, 0005, 0026, 0027 and 0030, and row 3 alone on ts-0035 and ts-0040, where vector search misses the anchors and the answer still scores 2.

**A candidate for golden set v2, not now:** more questions whose answers changed after the models' training cutoff, which memory cannot answer. The cited chunks listed for review, 52 in the final report and 54 in the first, wait for the same review. Nothing changes the frozen set until then (ADR-0009).

## Consequences

- A report with answers is larger, because it holds the answers. Only named runs are committed.
- The markdown never quotes Claude or the docs. The labelling sheet is the one exception, and git does not see it.
- `drl eval verify` ignores the answers section, since answers do not repeat.

## Alternatives considered

- **Sonnet 5.5 as the judge.** Cheaper, but the model would grade itself.
- **The Batch API.** About half the price, but it loses latency and adds a second path for requests.
- **Asking the judge everything in one prompt.** Support needs the passages and correctness must not depend on them, so they stay apart.
- **Asking for confirmation at a prompt.** `--yes` works in scripts and tests, and the estimate is printed either way.
