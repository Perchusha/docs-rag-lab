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
| Support | 10, the answers that cite something | 1 | The interval is there because 14 of 15 still means somewhere from 70% to 99%. If the judge's prompt changes after labelling, those 15 are no longer blind, and about 5 fresh ones are needed.

### 6. Noise

Differences between rows use the same sign test and verdicts as retrieval (ADR-0010). Unlike retrieval, answers have run-to-run noise too. `--noise` answers row 3 a second time and asks the judge a second time about row 3's first answers, so a report says how far a row differs from itself and how often the judge repeats its grade. A difference between rows that a row also shows against itself means nothing.

## Consequences

- A report with answers is larger, because it holds the answers. Only named runs are committed.
- The markdown never quotes Claude or the docs. The labelling sheet is the one exception, and git does not see it.
- `drl eval verify` ignores the answers section, since answers do not repeat.

## Alternatives considered

- **Sonnet 5.5 as the judge.** Cheaper, but the model would grade itself.
- **The Batch API.** About half the price, but it loses latency and adds a second path for requests.
- **Asking the judge everything in one prompt.** Support needs the passages and correctness must not depend on them, so they stay apart.
- **Asking for confirmation at a prompt.** `--yes` works in scripts and tests, and the estimate is printed either way.
