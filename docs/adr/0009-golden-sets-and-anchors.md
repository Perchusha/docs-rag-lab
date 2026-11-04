# ADR-0009: Golden sets and their anchors

- Status: accepted. ADR-0015 says who reviews a new source's set.
- Date: 2026-11-02
- Milestone: M4

## Context

M4 measures every retrieval and answer change against a golden set, so the set decides what the numbers mean. A human reviewed the 40 draft questions against the index at `205122bb`. Every one of the 52 anchors resolved under the rule SPEC section 10 had then: a chunk matched when its anchor was the fragment or a heading inside it slugged to the fragment. The review still found that this rule let the metrics claim things that were not true:

- **ts-0039:** the option page ranked 1 in both strategies and counted as a hit, but it says the opposite of the expected answer. The answer is in the 6.0 release notes, ranked 36 by vector search and 13 by hybrid, and the options table has the new default as a bare value.
- **ts-0035:** vector search counted rank 2, which is part 6 of 6 of the section, about `DisposableStack`. The part with the answer ranks 17.
- **ts-0001:** rank 1 was the last part of the section. The key sentence is in the first part, at rank 4 and 2.
- **ts-0027:** `Compiler Options.md#compiler-options` matched 7 chunks, and 4 of them name no strict option. No single chunk holds the answer.
- **ts-0004:** the 3.0 release notes answer the question directly, at rank 1 and 2, yet they counted as a miss.

SPEC section 6 also planned `eval_runs` and `eval_results` tables in the per-source index, next to committed reports in section 10, which is two places for one result.

## Decision

### 1. Primary and acceptable anchors

A question has `primary` anchors, the passages its answer was written from, and `acceptable` anchors, other passages that also support the answer and are never required. Metrics are reported both ways, and primary metrics are the headline (section 9). Primary anchors are all required by default, since ts-0038 needs three sections for one answer. `"primaryMatch": "any"` says each one is enough on its own; ts-0040 is the only such question, because the 5.7 and 5.9 notes show the same error text.

An acceptable anchor supports the answer itself, if less fully than a primary one: the handbook chunks of ts-0040 show the error on an example, without its text. A chunk that backs only a caveat, or cannot answer half of a two-part question, is not one, since a hit on it would count with the answer missing from the context. Most acceptable anchors came from reading what vector and hybrid search return in their top 8, the usual way to judge relevance when no one can read 994 chunks per question. That favours chunks these two strategies can find, so a later strategy that surfaces a new correct chunk needs a new judgment before its numbers are compared.

ts-0040's primary anchors are the release notes because only they state the error text: until M7 compiles the examples, the handbook chunks have just `// @errors: 2345`. Its `note` says to revisit this after M7.

### 2. An anchor may pin a passage

`{"at": "...", "contains": "literal passage"}` matches only the chunks of that section that contain the passage. It is a literal string so that it is easy to review and can fail: if a sync removes the passage, the question goes stale instead of quietly matching another part.

| Question | Best rank before (vector, hybrid) | With the pin |
|---|---|---|
| ts-0001 | 1, 1 | 4, 2 |
| ts-0034 | 1, 2 | 1, 3 |
| ts-0035 | 2, 1 | 17, 1 |

A pin is only for a section whose answer is in one of its parts. A second reading removed the pins from ts-0026 and ts-0037, where more than one part answers: the ts-0037 pin had moved a correct rank 1 to rank 2.

### 3. The chunker records which sections a chunk contains

Slugging headings at eval time would need each source's slug rules in core and a fence scanner, and it cannot tell one `### Example` from another. The chunker already has the parser's fragments, so `metadata.anchors` holds them, and core reads that. `CHUNKER_VERSION` 5 forced a re-parse.

Compared with the old rule on all 994 chunks of the real index, every difference has a known cause:
- 198 differences are duplicate headings. The old rule matched `#example` in every chunk with a `### Example`; the recorded anchors are `example`, `example-1`, and so on, as on the site.
- 17 are headings on option pages, where the parser gives sections no anchors because the pages have none. An anchor on an option page is the whole page.
- None is anything else.

A naive match on any heading-shaped line would also have accepted shell comments in code blocks in 2 chunks.

The re-parse took 2.1s and 0 tokens. The documents, the chunks apart from the new field, every vector, the size of the keyword index, and the rankings and contexts of all 45 questions in both strategies came out identical.

### 4. A lock instead of a stored status

SPEC section 9 asks a sync to flag questions whose anchor chunks changed or disappeared. An anchor that still resolves can sit on changed text, so this needs a record of the text a human reviewed. `eval/questions.lock.json` maps each anchor to its chunk IDs and text hashes at the last review. `drl eval check` compares the index with it:
- **stale:** an anchor the question needs is gone. Metrics leave the question out.
- **review:** the text changed, or an anchor it does not need is gone. It is still scored.

The lock compares anchored text only, and that is its limit: text added elsewhere is invisible to it. A new option page would make ts-0044 wrong, and new release notes can contradict an anchored page, the way the 6.0 notes contradict the option page in ts-0039. So the lock also records the docs commit, and when the index is at another one, the check says so, sends the unanswerable questions to review and fails until a human accepts. It cannot say which answered question a new page contradicts; that takes the re-read.

`--accept` rewrites the lock, and refuses while any anchor does not resolve. `drl sync` prints the same summary but does not fail on it. A test in the CLI checks in CI, with no index, that the lock covers exactly the anchors of the file, so an anchor cannot be added without a real check.

### 5. A sync can pin a commit

`drl sync` always moved to the head of the branch, so any re-parse during M4 could have changed the corpus under the golden set, and no report could be reproduced after upstream moved. `drl sync <source> --at <sha>` indexes that commit. It takes a full SHA, because git fetches a commit by its full name only, and it does not check that the commit is on the source's branch. The pin is not stored: the next sync without `--at` returns to the head, which is why a chunker mismatch tells you to re-sync at the index's own commit.

### 6. Results live in committed reports, not in the index

The index is generated and gitignored, and a rebuild can replace it, while results must outlive it and be readable in a diff. `eval_runs` and `eval_results` are dropped from SPEC section 6. Named runs (the baseline, after the hypotheses, final) are committed as JSON and markdown under `eval/reports/`; development runs stay local and ignored. Recorded answers and judge verdicts are cached in `data/eval-cache.sqlite`, its own file, so it can be deleted without touching the embeddings.

### 7. What counts as correct on an unanswerable question

A correct answer says the docs do not cover the question or, for a false premise (ts-0044, ts-0045), rejects it, and cites nothing as support for an answer. Naming a version, describing the made-up option, or presenting outside knowledge as coming from the docs is a hallucination, reported separately from a plain wrong answer: inventing something is a different failure from missing the answer, and a different thing to fix.

### 8. RRF weights are not tuned in M4

SPEC section 9 and the settings said M4 would tune k and the list weights. A sweep over 40 questions would fit noise, and the same questions would then report the result. They stay at the usual defaults. M4 tests the two hypotheses in SPEC section 13, each decided on the full set; if those leave a gap, the M5 reranker is the next lever. Any later tuning needs held-out questions.

### 9. The set is frozen

The golden set is frozen after the second review. This is the rule from now on:

- **Primary metrics are the headline.** Acceptable anchors are secondary, because many of them were found by looking at what the current retrievers return, which favours those retrievers.
- **A later change must be justified by the docs text, not by a ranking.** A question is not edited because a strategy does badly on it, or because a chunk ranks high.
- **Each change gets a new set version** and an entry in the changelog below.
- **Every strategy in a report is then re-scored on that version.** Numbers from two versions are never compared.
- **The judge proposes, a human decides.** When the judge says a cited chunk supports a correct answer but that chunk is not an anchor, the report lists it as a candidate for review. It is not added automatically, and adding it follows this same rule.

The version and a hash of the file are in the lock, so the freeze is checked and not only stated. `drl eval check` fails when the file differs from its lock, `--accept` then needs `--set-version` with the next number, and a test in the CI run fails when the file does not match the lock or the version has no changelog entry. A docs sync that changes anchored text does not change the set, so accepting it keeps the version.

## Set changelog

| Source | Version | Set hash | Date | Change | Reason from the docs text |
|---|---|---|---|---|---|
| typescript | 1 | `0d270eac9aef` | 2026-11-03 | The first reviewed set: 40 answerable questions and 5 unanswerable, at docs `205122bb` | The first version. Each expected answer and anchor was checked against the anchored text in two reviews |

## Measured before and after

The same retrieval over the same index, on the 40 questions with anchors. Only the golden set changed: its grading, and the wording of six questions (ts-0007, 0013, 0014, 0019, 0027, 0033). The draft rows use the draft questions.

| | hit@1 | hit@8 | MRR |
|---|---|---|---|
| Vector, draft anchors, any part | 29 | 38 | 0.817 |
| Vector, primary | 26 | 36 | 0.751 |
| Vector, primary or acceptable | 32 | 36 | 0.851 |
| Hybrid, draft anchors, any part | 23 | 37 | 0.730 |
| Hybrid, primary | 19 | 36 | 0.657 |
| Hybrid, primary or acceptable | 27 | 37 | 0.787 |

The old rule flattered hit@8, and it counted correct chunks it had no anchor for as misses. On primary anchors, the headline, vector search does better on 14 questions and hybrid on 7, with 19 tied: an exact sign test gives p = 0.19, so 40 questions do not show that either is better.

## Consequences

- ts-0039 is now a miss in both strategies. That is the honest result: the context that reaches Claude does not hold the answer.
- A docs sync that touches anchored text, or moves to another commit at all, now asks for a human review. Text added elsewhere still needs that review to be read with care, because no check can say what it contradicts.
- The lock is a few hundred lines of hashes, committed and rewritten only by `--accept`.
- Pins are one more thing to review, so they are used only where a section spans several chunks and the answer is in one of them.

## Alternatives considered

- **Pinning to a part number.** Shorter, but it breaks silently when a section is re-chunked, and a reader cannot see what it points at.
- **Keeping the slug rule and fixing it per document.** A per-document slugger would solve the duplicates, but core would still need each source's rules, and a React source would bring its own.
- **Hashes inside the question file.** One file instead of two, but a human-edited file would fill with hashes, and every review would rewrite most of its lines.
- **Grouping alternatives in nested arrays,** for example `[["a", "b"], ["c"]]`. More general than `primaryMatch`, but only one of 40 questions needs it, and it is harder to read.
- **Unanswerable as a field rather than a tag.** It would duplicate the tag: the parser already ties the tag to having no anchors.
