# ADR-0010: Eval reports and what reproducible means

- Status: accepted
- Date: 2026-11-03
- Milestone: M4

## Context

SPEC section 13 sets the M4 acceptance: "Report is reproducible from SHA + config". ADR-0009 fixes what is measured. This ADR fixes what a report holds, what a difference between two reports means, and what "reproducible" can honestly promise.

Two facts shape it. Provider vectors are not reproducible, and 40 questions cannot resolve small differences.

## Decision

### 1. One report, split by what may differ

A report has four parts:
- `identity`: what was measured. The docs commit, the chunker and parser versions, the index schema, the embedding and context models, a hash of every chunk's ID, text hash and context, the golden set version and hash, a version of the retrieval code, and every retrieval setting. `drl eval verify` refuses to call a re-run with another identity a reproduction, and `drl eval compare` prints every difference, since comparing two configurations is what it is for.
- `result`: what came out, per strategy and per tag, with each question's anchor ranks and context. What retrieval produced is deterministic given the vectors, so it is compared byte for byte; means are rounded, and questions and tags are sorted. The targets and the review list sit here too but are judged apart, because the targets file and the lock can change with the search unchanged.
- `vectors`: hashes of the query vectors and the corpus vectors. They are kept out of `identity`, because the same text can get different vectors.
- `run`: what is true of this run alone: name, time, repository SHA, whether the tree was dirty, timings and token usage. It is never compared.

Reports hold chunk IDs and ranks, not chunk text or traces. A context alone is about 15 KB of chunk text per question, and any trace can be recomputed from `identity`.

`RETRIEVAL_VERSION` is bumped by hand when the code changes what a search ranks for the same settings, like `CHUNKER_VERSION`, since a change to retrieval code changes no setting. `EVAL_REPORT_VERSION` is bumped only when an existing field changes its meaning: a new section is optional and needs no bump, so committed reports stay readable.

### 2. Named runs are committed, development runs are not

`drl eval --name baseline` writes `eval/reports/<source>/<date>-<sha>-<name>.{json,md}`, and git sees it. It needs a clean tree and a clean golden check, measures every strategy, and never overwrites a report. Untracked files count as dirty even if the user's git config hides them; a file hidden through `.git/info/exclude` does not, and neither does a stale `node_modules`. A run with no name goes to `eval/reports/<source>/dev/`, which git ignores, and may run on a dirty tree, which the report states.

Report JSON is recorded data: it holds chunk labels from the docs, and from PR 4 raw answers from Claude. So `eval/reports/**/*.json` is left out of Prettier and of the em-dash check. The markdown stays checked, and for that reason it never quotes the docs or Claude.

### 3. Reproducible means two different things

The same text gets different vectors depending on what else is in the request. Measured on the 45 questions of set version 1, with one Voyage request each:

| Compared | Bitwise equal | Lowest cosine |
|---|---|---|
| The same batch sent twice | 45 of 45 | 1 |
| A fresh batch against the cached vectors, which came from other batches | 1 of 45 | 0.999945 |
| One text alone against the same text in a batch | no | 1.000000 |

Through the real `retrieve()`, those fresh vectors kept the top 8, in order, for 45 of 45 questions under both strategies. The full ranking changed for 5 of 45.

So `drl eval verify <report>` has two bars:
- **The same vectors:** what was measured must match byte for byte. If it does not, the code changed or is not deterministic.
- **Other vectors:** the conclusions must match: every question's context in order, every rank inside the context, every count at every cutoff, overall and per tag, for primary and acceptable anchors, every verdict and every target. Only ranks below the context may move, and the MRR with them. Those are listed.

Comparing totals alone is not enough: two questions can trade places and leave every count the same, and a deep rank can flip a verdict.

Other vectors and other code together are **inconclusive**, even with every number the same, because the check cannot tell which of the two it is looking at. It asks for a run at the report's commit with a clean tree.

A different identity is not a failed reproduction but a different measurement: the check says so, and names the commit to sync when that is the reason.

The harness embeds the golden set in one request, in ID order, which also spares the free trial's 3 requests a minute. The cache keeps the first vector it saw for a text, so the vectors of a long-lived machine still come from older batches. That is why the second bar exists.

### 4. A difference has to earn its name

Scores are compared question by question, overall and per tag, with an exact two-sided sign test over the questions that differ. The verdict is one of:
- **too few:** the scope has 5 questions or fewer, where even 5 of 5 gives p = 0.0625, so no result could count;
- **noise:** the sides differ by one or two questions;
- **not significant:** they differ by more, but p >= 0.05. The smallest splits that do reach it are 6:0, 8:1, 10:2, 12:3, 13:4 and 15:5, so a gain of 5 questions with no losses is still not significant, and the report says so;
- **mixed:** significant, but one side won more questions and the other has the higher total, as when ten small wins meet two large defeats, so no side is named;
- **better:** anything else.

A sign test needs no dependency and no seed, so its result is part of the deterministic result. It ignores how far a rank moved, which is the right bias for a set this small: a metric that rewards one large move would let a single question decide. That is also why the totals sit beside it, and why they can disagree. With about 7 tags and 6 metrics there are many tests in one report, so one low p is not proof, and the report says so.

Retrieval has no run-to-run noise, since it is deterministic. The noise here is which 40 questions were asked.

Ranks stop at the depth of one candidate list, 50, for both strategies. Fusion can rank deeper, up to 150, and a hybrid rank of 60 against a vector search that stopped at 50 would otherwise count as a win.

### 5. Targets live with the source

The M2 targets in SPEC section 13 are in `packages/sources/<id>/eval/targets.json`, as a question, one of its anchors and a rank to reach. A target that names an anchor its question does not have is refused. A target is met by the default strategy, hybrid, and the ranks of the other strategies sit beside it.

Targets are not part of the golden set, so changing one does not change the set version.

## Measured

The first named run, at docs `205122bb` and set version 1:

| Primary anchors | hit@1 | hit@3 | hit@5 | hit@8 | recall@8 | MRR |
|---|---|---|---|---|---|---|
| Vector | 26 | 34 | 36 | 36 | 0.879 | 0.751 |
| Hybrid | 19 | 34 | 35 | 36 | 0.881 | 0.657 |

Vector is better on 14 questions and hybrid on 7, with 19 tied: p = 0.189, not significant. hit@1 differs by 10 against 3, p = 0.092, also not significant. The code-reviewer recomputed these independently from the raw rows and from the index, with its own KNN, anchor resolution and RRF, and found no mismatch in any of the 80 strategy-question rows.

## Consequences

- A report is about 180 KB of JSON, most of it per-question rows and chunk labels. A few named runs per milestone is fine; a report per commit would not be, which is one reason development runs stay out of git.
- `drl eval verify` needs the index at the report's docs commit. `drl sync <source> --at <sha>` gets there, and rebuilding from nothing takes about an hour on the free trial.
- Numbers from two golden set versions cannot be compared: `drl eval compare` refuses (ADR-0009, section 9).

## Alternatives considered

- **Tables in the index for runs and results.** See ADR-0009, section 6.
- **Committing the query vectors,** about 250 KB per set version. It would pin the query side only: the corpus vectors would still differ on another machine, so the second bar would still be needed.
- **Embedding each question alone,** which would make its vector independent of the rest of the set. At 3 requests a minute that is 15 minutes per new set, and it does not help the corpus.
- **A paired t-test or a bootstrap for the MRR.** More sensitive, but a t-test assumes a distribution these ranks do not have, and a bootstrap adds a seed to a result that should not need one.
- **A flag to allow a named run on a dirty tree.** A named report exists to be reproduced from its SHA, and a dirty tree cannot be.
