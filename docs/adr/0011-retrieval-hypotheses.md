# ADR-0011: Testing the two retrieval hypotheses

- Status: rejected. No config met the targets, so nothing was adopted (see Result).
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

From the query plans of the golden set under each config, with no index and no ranks:

| | Questions whose query changes |
|---|---|
| H1 (13) | ts-0002, 0003, 0004, 0007, 0010, 0012, 0025, 0026, 0027, 0029, 0033, 0034, 0035 |
| H2 (15) | ts-0001, 0002, 0003, 0004, 0005, 0007, 0018, 0020, 0021, 0022, 0023, 0024, 0026, 0032, 0039 |
| H1+H2 (23) | the union of the two |

This has two consequences, known before any run:

- **H2 alone cannot meet the targets.** It does not touch ts-0033 or ts-0027. It is still run, because the SPEC asks for it and because H1+H2 cannot be read without it.
- **Both ts-0040 rows cannot move,** since neither hypothesis changes that question's query.

With 13 or 15 questions able to move, a significant result needs nearly all of them to move one way (6:0, 8:1, 10:2). So `not significant` is the likely verdict even for a real effect, and it does not fail a config by itself.

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

## Result

No config met the targets, so nothing was adopted, and the defaults and the code on main are as they were. The sections above are unchanged from before the run.

The integrity checks all passed. On `hybrid`, primary anchors, against the control:

| Target | Control | H1 | H2 | H1+H2 |
|---|---|---|---|---|
| ts-0033, rank 1 | 3 | 2 | 3 | 2 |
| ts-0027, pinned to `--strictNullChecks`, rank 6 or better | 9 | 14 | 9 | 14 |
| ts-0004, rank 2 or better | 7 | 4 | 4 | 3 |
| ts-0040, release notes, top 8 | 3, met | 3, met | 3, met | 3, met |
| ts-0040, handbook, top 8 | 6, met | 6, met | 6, met | 6, met |

| Full set | Control | H1 | H2 | H1+H2 |
|---|---|---|---|---|
| hit@1 / 3 / 5 / 8 | 19 / 34 / 35 / 36 | 18 / 32 / 35 / 35 | 19 / 34 / 36 / 36 | 18 / 33 / 35 / 35 |
| recall@8 | 0.881 | 0.856 | 0.881 | 0.856 |
| MRR | 0.657 | 0.642 | 0.660 | 0.644 |

- **T:** failed by all three. **G:** passed by all three. Every overall verdict is `noise`, so no config shows a gain or a loss on the full set.
- **Primary ranks that moved.** H1: ts-0004 7 to 4, ts-0010 3 to 2, ts-0033 3 to 2, ts-0034 3 to 5, and ts-0035 1 to 11, which leaves the top 8. ts-0027's best primary anchor stays at 1, and only its pinned anchor moves. H2: ts-0004 7 to 4, ts-0024 40 to 36, ts-0022 15 to 17. H1+H2: the same, with ts-0004 at 3.

The reports are `eval/reports/typescript/2026-11-03-f9993e79-m4-{control,h1,h2,h1-h2}.{json,md}`.

## Diagnosis

Control against H1 only, for the six questions H1 moved most plainly. Reports hold no traces (ADR-0010), so the traces were recomputed at `f9993e7`, under the same two configs, with a provider that could not reach the network. Every recomputed context matches its report, and no new config was run.

`v`, `k` and `e` are the anchor's rank in the vector, keyword and exact lists under the control. Under H1 the vector and keyword ranks stay the same, and the exact list is skipped.

| Question | Under H1 | v | k | e | Which list moved it |
|---|---|---|---|---|---|
| ts-0027, pinned | 9 to 14 | 6 | 37 | 8 | The exact list, on `strict` alone, had it at 8. The keyword list, which also ORs "flag" and "enable", has it at 37. |
| ts-0034 | 3 to 5 | 1 | 38 | 16 | The same: exact 16, keyword 38, which also ORs "type", "parameters" and "added". Four chunks about generic type parameters pass it on keyword rank. |
| ts-0035 | 1 to 11 | 17 | 47 | 5 | The same: exact 5, keyword 47, which also ORs "typescript", "version", "added" and "declarations". The two `Variable Declarations` chunks on `using` were exact 1 and 3 and not in the keyword top 50, and they fall from ranks 2 and 3 to 22 and 24. |
| ts-0004 | 7 to 4 | 2 | 9 | 9 | The exact list repeats the keyword order: the top six chunks are k1 e1, k2 e2, k3 e3, k4 e4, k5 e5, k6 e6. BM25 counted twice outweighed the vector rank of 2. Without it, chunks at k1, k2 and k6 with good vector ranks stay above. |
| ts-0010 | 3 to 2 | 1 | 2 | 14 | The exact list, on `readonly`, preferred two other chunks (e6, e8). Without it the anchor ties for first with a chunk at v2 k1, and the chunk ID decides. |
| ts-0033 | 3 to 2 | 1 | 5 | 5 | The exact list repeats the keyword order (k1 e1, k2 e2, k5 e5). The keyword list alone puts a chunk on `@satisfies` first (v2 k1), so removing the second count could never reach the target of 1. |

The six split cleanly. In all three regressions the anchor's exact rank is far better than its keyword rank. In the three gains it is equal (ts-0004, ts-0033) or worse (ts-0010). So H1's mechanism is real where the exact list repeats the keyword list, as for `unknown` and `satisfies`. Where the keyword query also holds generic words, the exact list is the only keyword list that follows the question's topic, and H1 removes that too.

Which list moved each anchor is measured. That generic terms are what buries the anchors in the keyword list is a reading of the queries, and was not tested on its own. The six were chosen because they moved, so this describes them and proves nothing about the other questions.

All six anchors stay in the fused top 20 under both configs, which is what the M5 reranker reads.

## Candidate for M5, not tested

One BM25 list in which a backticked word counts for more than the other terms, instead of a second list for it. It would keep the topic signal that ts-0027, ts-0034 and ts-0035 lost, without a second entry in the fusion for ts-0004 and ts-0033. This is a candidate and nothing more. These six questions suggested it, so they cannot be its evidence, and it needs its criteria fixed first, like this test.

## Reproducing this

The code never reached main. The tag [`exp/m4-h1-h2`](https://github.com/Perchusha/docs-rag-lab/tree/exp/m4-h1-h2) keeps the commit that measured the reports, `f9993e7`. At main, `drl eval verify` on these reports says not comparable, which is correct: main has no such settings, and its index is schema 3.

Use a separate worktree, because opening an index at the tag migrates it to schema 4, and main refuses that:

```
git worktree add --detach ../drl-exp exp/m4-h1-h2
cd ../drl-exp
pnpm install --frozen-lockfile
pnpm drl sync typescript --at 205122bb73dcbf6f3b373de5bdb0d9fa5434d015
pnpm drl eval verify <main checkout>/eval/reports/typescript/2026-11-03-f9993e79-m4-h1.json
```

The new worktree has no embedding cache, so the sync embeds the corpus again: about an hour on the free trial (ADR-0010). The vectors will then differ, so `verify` applies its second bar. On this machine, at `f9993e7` on the same vectors, all four reports reproduced byte for byte.
