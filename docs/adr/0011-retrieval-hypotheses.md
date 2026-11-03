# ADR-0011: Testing the two retrieval hypotheses

- Status: proposed. The criteria are fixed and no run has been made.
- Date: 2026-11-03
- Milestone: M4

## Context

Hybrid search made three anchor ranks worse than vector search alone. SPEC section 13 gives the targets, in `eval/targets.json`, and two hypotheses to check "on the full golden set and not tuned to these four questions". The baseline at docs `205122bb` and set version 1 meets 2 of the 5 target rows, with hybrid at MRR 0.657 and hit@8 36 of 40.

This ADR fixes the test before any run, so that the result cannot shape what counts as success. Only H1, H2 and H1+H2 are tested. Any new idea is a separate hypothesis, written down first.

## What is tested

Two settings, so that all four runs come from one commit and each is reproducible from SHA + config. The report's identity records them.

| Run | `exactTokens` | `shortTerms` |
|---|---|---|
| Control | `all` | `substring` |
| H1 | `code-shaped` | `substring` |
| H2 | `all` | `whole-word` |
| H1+H2 | `code-shaped` | `whole-word` |

RRF, k, weights, list depth, the targets and the golden set do not change.

**H1, as SPEC section 13 writes it: limit exact tokens to code-shaped ones.** An exact token is dropped when it came from backticks and is one lowercase word with no leading dashes. Everything else stays: identifiers (camelCase, PascalCase, or with digits), flags with or without backticks, source tokens, and code with punctuation or spaces. A dropped word stays a search term, so it still reaches the keyword list. A backticked stopword such as `this` is then searched by neither keyword list; no question in the set has one.

**H2, as SPEC section 13 writes it: match 3-character terms as whole words, through a second unicode61 table.** A term or exact token of exactly 3 letters or digits goes to a new table, `chunks_words`, in both the keyword and the exact list, since both lists are trigram queries today. Longer terms stay on trigram, and so do 3-character tokens with punctuation, which unicode61 would strip. When a list has both kinds, the scores are summed per chunk, because BM25 is a sum over terms. It remains one list in the fusion.

## What can move

From the question text alone, with no index and no ranks:

| | Questions whose query changes |
|---|---|
| H1 (14) | ts-0002, 0003, 0004, 0007, 0010, 0012, 0024, 0025, 0026, 0027, 0029, 0033, 0034, 0035 |
| H2 (15) | ts-0001, 0002, 0003, 0004, 0005, 0007, 0018, 0020, 0021, 0022, 0023, 0024, 0026, 0032, 0039 |
| H1+H2 (24) | the union of the two |

This has two consequences, known before any run:

- **H2 alone cannot meet the targets.** It does not touch ts-0033 or ts-0027. It is still run, because the SPEC asks for it and because H1+H2 cannot be read without it.
- **Both ts-0040 rows cannot move,** since neither hypothesis changes that question's query.

With 14 or 15 questions able to move, a significant result needs nearly all of them to move one way (6:0, 8:1, 10:2). So `not significant` is the likely verdict even for a real effect, and it does not fail a config by itself.

## Integrity checks

These come first. If one fails, the numbers are not read as a result: find the cause, fix it, and run all four again, and this ADR records that it happened.

1. Every run has the baseline's vectors: queries `3cbc8c2527dd`, corpus `8224c2d1af73`. So code is the only thing that differs.
2. The control's `result` equals the baseline's in every field. Its identity differs only in `indexSchema` and the two new settings.
3. The `vector` strategy is identical in all four runs, since neither setting applies to it.
4. A question whose query does not change under a config keeps every rank and its whole context.
5. `drl eval verify` on each report says byte for byte, on the same vectors.

## Criteria

A config passes if both hold, for `hybrid`, on primary anchors, on all 40 questions, against the control:

**T. The targets.** All 5 rows of `targets.json` are met, with the file unchanged: ts-0033 rank 1, ts-0027 (pinned to `--strictNullChecks`) rank 6 or better, ts-0004 rank 2 or better, and both ts-0040 anchors in the top 8.

**G. No harm on the full set.** On each of hit@1, hit@3, hit@5, hit@8, recall@8 and MRR, overall:
- the control wins by at most 2 questions net, which is ADR-0010's line for noise; and
- the verdict from `drl eval compare <control> <config>` is not `mixed`.

Per-tag results and acceptable anchors are reported, and do not decide (ADR-0009, section 9). Any question whose primary anchor leaves the top 8 is named in the result, even within noise.

## What happens next

- **No config passes:** nothing is adopted, and the defaults stay. Report that and stop, with no new variants and no change to a target or a threshold. The SPEC names the M5 reranker as the next lever, and the owner decides.
- **One passes:** it becomes the default.
- **H1 and H1+H2 both pass:** H1, the simpler one with no schema change, unless `drl eval compare <H1> <H1+H2>` says H1+H2 is `better` on overall MRR or hit@1.

Adopting a config means flipping the default, removing the code of whatever was not adopted, and committing a named run, `after-hypotheses`. Its measured result must equal the adopted config's run.

## What a pass does and does not show

A pass means the named regressions came back with no harm shown on the full set. It does not mean retrieval got better. That claim needs a `better` verdict from the comparison. Three configs and 6 metrics make 18 tests overall, so even one low p is weak evidence, and the result says so.

The four target questions are in the set and were known when the hypotheses were written, so meeting them is not out-of-sample evidence. The other questions that can move are the check.
