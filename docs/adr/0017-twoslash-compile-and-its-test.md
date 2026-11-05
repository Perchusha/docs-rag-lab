# ADR-0017: The twoslash compile, and what M7 tests on it

- Status: accepted as the test, before any compile, compiled index, new question or answer exists.
- Date: 2026-11-05
- Milestone: M7

## Context

SPEC section 8 asks M7 to compile the TypeScript docs' examples with twoslash at ingest, to put the real compiler errors and inferred types in the chunk text, and to keep the structured output in metadata for M8's verified questions. Today the chunks hold the examples as written: a directive such as `// @errors: 2345` names an error, and nothing says what it is. ADR-0009 fixed ts-0040's anchors by that gap, and its note asks to revisit them once the examples compile.

M7 runs under the lighter process of ADR-0015. This ADR fixes the test before any compile, so that the result cannot shape what counts as success. Anything not written here is a separate hypothesis, written down first. The owner approved the plan on 2026-11-05, with three decisions: 8 new questions on error codes, chosen by a rule fixed here before any compile; a blind spot check of the judge on 10 answers; and a stop below 90% of examples compiled, with a limit of $10 of Claude.

**What the plain index holds,** read from it with no API call, at docs `205122bb`:
- About 720 code blocks are fenced as twoslash, in 76 files: 373 in `handbook-v2/`, 118 in `reference/`, 68 in `release-notes/`, 62 in `javascript/` and 97 option pages. Their directives are 191 `@errors`, 57 `@filename`, 56 `@showEmit` or `@showEmittedFile`, 40 `@noErrors` and 147 `---cut---`, with 244 `^?` queries.
- 217 of the 994 chunks hold a directive line, 113,747 tokens of the 506,031.
- 18 of the 40 answerable questions have a primary anchor on such a chunk. Of the 10 tagged `exact-token`, 5 do, and hybrid already ranks 2 of those 5 first. With ts-0040, compiling can move at most 4 of the 10 directly, so that tag cannot reach the smallest significant split, 6 to 0, by what compiling adds to its own chunks. That is why the 8 questions below exist.

## What is built

**A second index, so that M4 to M6 stay reproducible.** The compiled index is `data/sources/typescript.compiled.sqlite`, built at the plain index's commit, `205122bb`, which it takes from the plain index, as the contextual index does (ADR-0014). The plain, contextual and control indexes are never written to.

**The code stays byte for byte, and the output follows it.** A code block keeps its text, directives included, and gets an optional `compiled` field (SPEC section 7). In the chunk text, the output follows the block, as the docs site shows it under the example: each error with its code, line and message, and each `^?` query with its line and type. With `@showEmit` or `@showEmittedFile`, the emitted file follows as a code block of its own, labelled with its name. So every `contains` anchor that resolves on the plain index resolves on the compiled one, `@errors: 2345` included. The chunk's metadata holds the same output, structured, and the error codes of that chunk, which ADR-0005 found coarse per document.

**For a block with no `compiled` field, the chunker writes the same bytes as today.** So the chunker and parser versions of the plain index do not change, and its chunks keep their hash, `ba7aae0e36d9`. The compiled index records its own parser version and the compiler's versions in its manifest, and a report on it names them in its identity.

**The compiler is `twoslash` 0.3.9 with `typescript` 6.0.2.** 6.0.2 is the version the docs pin at this commit, in their root `package.json`. The repository typechecks with `~6.0.3`, so the docs' version comes in under an alias and reaches twoslash as its `tsModule`. `typescript` 7.0.2 is outside twoslash's peer range, `^5.5 || ^6`. The docs site compiles with its own fork of twoslash, so some examples may behave differently, which the survey will show.

**An example compiles when twoslash runs it with its default validation:** every error the example raises is one its `@errors` line names, and every named error is raised. A block that does not compile gets no output and keeps its text, and the reason is recorded. No type package is added for the first compile. A file per docs commit, `eval/compile/typescript/<docs sha>.json`, records each block that did not compile and why, by class, and it is committed.

**Nothing else changes:** prompts, models, RRF, list depth, rerank depth, the retrieval code's version, exact tokens and the app. A change to any of them is a new hypothesis.

**What the harness needs:**
- **Ladder row 7, hybrid on the compiled index,** read the way row 5 reads the contextual index. Row 6 stays M9's. Row 7 is answered twice with `--noise`.
- **Version 1 of the set stays beside version 2,** byte for byte, with its lock. `drl eval verify` compares the golden set in a report's identity, so without this every TypeScript report before M7 would turn `not-comparable`. A report is checked against the set its identity names, by hash, and the dashboard reads the questions of that set too.
- **A lock for each index.** The compiled index's chunks differ in IDs and text, so `drl eval check --compiled` keeps its own lock beside the plain one, with the same set hash.
- **`drl eval compare --without-tag <tag>`,** so that C2 can be read on the questions that predate M7.
- **`drl eval label --spot` takes this ADR's mix,** below. Today it takes ADR-0016's, from rows 0, 3 and 4.
- **The compiled index names its compiler in the manifest's field for what else wrote a variant's chunks,** with the prefix `compiler:`, and a report's identity names it from there. A column of its own would change the index schema, which every report's identity names, so no report before M7 would verify.
- **The dashboard's first screen for a report with row 7** asks whether the compiled index finds the right chunks higher, from the compiled index's own report, and whether that reaches the answers, row 3 against row 7. It says that the app stays on the plain index when no verdict names row 7.

## The golden set, version 2

**It changes before any measurement, and the changelog in ADR-0009 records why.** Nothing on the compiled index is searched or ranked before the set is frozen. The owner reviews every question this section adds or changes.

### ts-0040

After the compiled index exists, and before any retrieval on it, its chunks in `Everyday Types.md#literal-inference` and `Object Types.md#excess-property-checks` are read for TS2345's message. If they state it, they become primary anchors beside the two release notes, with `primaryMatch: any`, and the note is rewritten to say why. If they do not, the anchors stay, and only the note changes, to record the revisit.

On the plain index this changes no number: hybrid ranks the release notes 3rd and the handbook chunks 6th, so its best rank stays 3, and vector finds none of them in its top 50. Integrity check 6 holds that.

### 8 questions on error codes

**The rule, fixed here before any compile.** For each error code named in a `// @errors:` line, count the chunks of the plain index whose text holds it, by the parser's own reading of the directive. Keep the codes held by 2 to 6 chunks, leave out 2345, which ts-0040 asks about, and order them by more chunks first, then by the lower code. Take the first 8. One chunk would give a single fragile anchor, and more than 6 would give more anchors than a review can read.

On the plain index at `205122bb` the rule gives, with their chunks: **TS2367** (6), **TS2532** (6), **TS2341** (5), **TS2540** (5), **TS2554** (4), **TS2344** (3), **TS2375** (3) and **TS2571** (3). In order, the next are TS7006 and TS18046, both 3.

**One fallback, also mechanical.** If, after the compile, no chunk of a chosen code shows that code's message, the code is replaced by the next by the same rule, and the ADR says which and why. TS2571 may be one: the current compiler reports TS18046 where older ones reported TS2571.

**Past the named fallbacks, by the same list.** The owner asked for this on 2026-11-05, after PR 3 found that no chunk of the compiled index shows the message of TS2375 or of TS2571, and before any replacement was chosen or anything was searched on the compiled index. The list is the rule's own: the codes held by 2 to 6 chunks of the plain index, 2345 left out, more chunks first, then the lower code. It is read from the top, and a code is kept when at least one chunk of the compiled index shows its message, as a line of compiler output that gives the code and the message. The reading stops when 8 are kept. A code that shows no message is skipped, TS7006 and TS18046 included, and the next one down is tried. Nothing else decides: no code is picked or passed over by hand. If the list runs out before 8, the work stops and the owner is asked.

**Each question is the same sentence:** "What does error TS<code> mean?", tagged `exact-token` and `error-code`. Its primary anchors are every chunk whose directive names the code, each pinned to its directive line, with `primaryMatch: any`, so they resolve on both indexes. Its expected answer is the compiler's message as the compiled examples show it, and what the examples show it on. A note says that the message's meaning is the main point and the examples are not required. All 8 are flagged.

**What C1's result covers.** The owner asked for this to be said plainly here and in the README. The 8 questions were added to make C1 measurable. So C1's result applies to error-code questions chosen by this rule, and not to `exact-token` questions in general. Of the 10 earlier `exact-token` questions, compiling can move at most 4 directly, and those are reported apart.

## Hypotheses

All on the set's version 2, with the verdicts the reports already give (ADR-0010, ADR-0013). Row 3 is hybrid on the plain index and row 7 hybrid on the compiled one.

### C1: does the compiled index find the right chunk higher, on error-code questions?

Hybrid on the plain index against hybrid on the compiled index, on the 8 questions tagged `error-code`, on primary anchors.

**Shown if** the verdict names the compiled index on MRR, and no verdict names the plain index on hit@1, hit@3, hit@5, hit@8 or recall@8.

**Its ceiling is written down before the compiled index is measured.** After the plain run on version 2, this ADR records on how many of the 8 hybrid already ranks a primary anchor first. If that leaves fewer than 6 that can move, C1 cannot be shown, and that is said before any number on the compiled index exists.

### C2: does the compiled index hurt the questions that came before?

The same two strategies on the 40 answerable questions of version 1, with `--without-tag error-code`.

**Holds if** no verdict names the plain index on hit@1, hit@3, hit@5, hit@8, recall@8 or MRR, and on each of them the plain index is ahead by at most 2 questions net. Any question whose anchor leaves the top 8 is named, even within noise. 217 chunks grow, and a longer chunk can match a question less well.

### C3: does that reach the answers?

Row 3 against row 7, on fully correct, all citations hold and wrongly refused, on the `error-code` tag and on all 48 answerable questions.

**Reached if** a verdict names row 7 and its margin passes twice the larger run-to-run count of rows 3 and 7, by ADR-0013's rule. Then the work stops, and the owner is asked whether the ts-docs app reads the compiled index, which needs C2 to hold. Otherwise the app stays on the plain index, and the compiled index is kept for M8.

**Reported, and deciding nothing:** the `exact-token` tag of 18, both ways; Claude without docs against row 7 on the `error-code` tag; correct and grounded; ts-0040's target from M2, in the top 8, as a diagnostic.

## The spot check of the judge

The prompts and the model do not change, so there is no calibration round (ADR-0015). Answers that cite compiler output are new to the judge, so the owner labels 10 answers blind, from a seed: 3 from row 0, 3 from row 3 and 4 from row 7, at least 5 of them on the `error-code` questions and 1 on a question the docs do not answer, with none on the same question twice.

- **It passes with at most one disagreement on each dimension it compares,** as in ADR-0016.
- **A miss stops the work,** and the owner is asked. The prompt does not change without the owner.
- **It has a file of its own,** which decides nothing for any other report. The labels are committed at once, under `eval/labels/typescript/`.

## What stops the work

The work stops, and the owner is asked, if:

- **Fewer than 90% of the twoslash blocks compile,** on the first compile, before anything is embedded. The failures are reported by class. Adding a type package to raise the rate is the owner's decision.
- **An integrity check fails.**
- **The plain index on version 2 differs from version 1** on any of the 40 earlier questions, which check 6 holds.
- **The forecast for M7 passes $10** of Claude.
- **Voyage rejects a call,** by ADR-0014's rules.
- **The spot check misses,** or **C3 is reached.**

A pilot of 5 questions comes first: the first question of the `error-code`, `exact-token`, `basic` and `edge` tags and the first unanswerable one, in id order. The estimate prints before anything is spent.

## Integrity checks

These come first. If one fails, the numbers are not read as a result.

1. **Every named report that reproduces today keeps doing so.** Before the first PR with code, `drl eval verify` runs on each named report of TypeScript and React, and records which say byte for byte. After each PR that changes shared code and at the end, the same ones say byte for byte again.
2. **The indexes stay as they are.** The sha256 of the plain index starts `403465a8`, the contextual index `9ceab39b`, the control `77aa7643` and React's `019e2afd`.
3. **What the dashboard builds is unchanged,** for every report of both sources, against a snapshot taken before the first PR with code, apart from what a PR says it adds.
4. **The compile is deterministic, and it keeps the code.** Two compiles give the same chunks. Every code block of the compiled index has the same bytes as in the plain index, and every compiled chunk's text is the plain text with only the compiler's output added.
5. **The lock comes first.** The commit that freezes version 2 is an ancestor of every commit an M7 report stamps.
6. **Version 2 changes nothing on the plain index for the 40 earlier questions:** per question, the primary and acceptable ranks of all three strategies equal those of `2026-11-04-6b2d15f7-final`.
7. **M7's reports reproduce byte for byte, and every cited text is in its chunk's text,** compiler output included, ignoring whitespace, as ADR-0014's check 7.

## Estimates

From M6's measured costs, with no API call: about $0.038 per answer with its judge in a row that reads the docs.

| Item | Estimate |
|---|---|
| Row 7, 53 questions answered twice, and their judge | about $4.00 |
| Rows 0, 2 and 3 on the 8 new questions, row 3 twice, and the judge again on ts-0040's rows for its new note | about $1.00 |
| The judge's second opinion on the new row 3 answers | about $0.30 |
| **Claude, in all** | **about $5.30**, with a limit of $10 |
| The compile | minutes, with no API call |
| Voyage embeddings, the changed chunks only, at most 217 chunks and about 114K tokens before the output | 15 to 25 minutes, inside the free tokens |
| Rerank | none: no hypothesis reads it on the compiled index |

## What the compile found

This section reports the first compile and the index it built, before the set changes and before any retrieval on it. Nothing above it changed because of it.

**The stop at 90% was not hit.** At `205122bb`, 712 code blocks are fenced as twoslash where the parser reads code blocks, and 654 of them compiled, 91.9%. Another 6 sit inside lists, where the parser keeps code as prose, as it always has, so they are not compiled. The 58 that did not compile:
- **39 name an error the compiler does not raise there.** 7 of them name TS2532, and 3 name TS2571, so none of the three chunks that name TS2571 shows its message.
- **18 raise an error they do not name.**
- **1 asks for completions,** and the compiler gives none.

[`eval/compile/typescript/205122bb73dcbf6f3b373de5bdb0d9fa5434d015.json`](../../eval/compile/typescript/205122bb73dcbf6f3b373de5bdb0d9fa5434d015.json) records each, with its reason. Three compiles gave the same record, which a fourth would be refused for not matching.

**The compiled index** has 248 documents and 1,019 chunks, against the plain index's 994, each with a vector. Its manifest names `compiler:twoslash 0.3.9, typescript 6.0.2` and parser version 2, at `205122bb`. It embedded 201 new texts: Voyage billed 97,046 tokens in 33 requests, in 13 minutes, which is $0.0058 at list prices and inside the free tokens.

**Integrity check 4 holds:**
- Each of the plain index's 2,306 code blocks is in the compiled index byte for byte.
- Of the 985 chunks with the same ID in both indexes, 934 have the plain text once the compiler's output is taken out. The other 51, and the 25 documents that the longer examples cut differently, hold every paragraph of the plain text. Only 7 headings moved, into the first line of a chunk they now open.
- 183 chunks show output, and 254 hold it in their metadata. The others' examples compiled with nothing to say. 21 chunks give TS2345's message.

**Every one of the set's 72 anchors resolves on the compiled index.** None is locked there yet: the compiled lock is written for version 2.

**The other integrity checks hold:** the same 10 named reports say byte for byte, both dashboards answer as before, and the four other indexes keep their sha256.

**One fault, caught before any number.** The first try broke every route of ts-docs: the compile read its files when its module loaded, and the app's bundler had moved the module. The dashboard check found it. The compile now loads nothing until it is used.

## The set's version 2, as frozen

Claude drafted it on 2026-11-05 by the rules above, from the text of both indexes' chunks, with no search and no answer read. The owner reviewed all 9 questions it adds or changes, in [`questions.review.md`](../../packages/sources/typescript/eval/questions.review.md), and it was frozen the same day, before anything was searched on the compiled index. Its hash starts `5eca5d63e26a`, and both locks, plain and compiled, record it, with 106 anchors.

**The codes,** read from the top of the list, by the rule past the named fallbacks:

| Code | Chunks of the plain index | Compiled chunks that show its message | |
|---|---|---|---|
| TS2367 | 6 | 6 | kept |
| TS2532 | 6 | 1 | kept |
| TS2341 | 5 | 5 | kept |
| TS2540 | 5 | 4 | kept |
| TS2554 | 4 | 3 | kept |
| TS2344 | 3 | 3 | kept |
| TS2375 | 3 | 0 | skipped |
| TS2571 | 3 | 0 | skipped |
| TS7006 | 3 | 2 | kept, the 7th |
| TS18046 | 3 | 0 | skipped |
| TS1005 | 2 | 1 | kept, the 8th |

So TS7006 and TS1005 take the places of TS2375 and TS2571. The three chunks that name TS18046 are the three that name TS2571 beside it, and their examples did not compile, because typescript 6.0.2 does not raise TS2571 there.

**The anchors.** The 8 questions are ts-0046 to ts-0053, in that order, with 35 primary anchors: one for each chunk whose directive names the code, pinned to the directive line. Each resolves on both indexes, only to chunks whose directive names the code. The compiled index cuts the Utility Types page differently, and one more of its chunks names TS2344, so TS2344 has an anchor for it, which on the plain index resolves to the same chunk as another of its anchors.

**ts-0040 had a case this ADR did not foresee:** one of its two handbook chunks states TS2345's message on the compiled index and the other does not. The literal inference chunk gives it. The excess property checks example did not compile, because typescript 6.0.2 raises TS2561 there, so its chunk does not. The owner decided it per chunk: the first is a primary anchor, and the second stays acceptable. The owner also had the expected answer drop the claim that the handbook shows TS2345 in excess property checks, since the compiler reports TS2561 there.

**What an expected answer requires.** The owner's rule for the 8, at the review: everything an expected answer requires is visible in the compiled chunks its anchors resolve to, and anything from general knowledge goes in the note as optional. Each answer was checked against the literals that show it. Five answers changed for it: ts-0046, ts-0047, ts-0048, ts-0051 and ts-0053. On ts-0053 the answer keeps to the one message the docs show, `',' expected.`, and the general form of TS1005 is in the note. The owner kept every anchor by the rule, including the 5 of TS2532's 6 whose examples did not compile, and the extra anchor of TS2344.

## Alternatives considered

- **Compiling into the plain index.** It would change the chunks every report before M7 was measured on, so none of them could be reproduced.
- **Pinning the new anchors to the compiler's text.** It would not resolve on the plain index, so the two indexes could not be compared on one set.
- **Measuring the existing set only.** The `exact-token` tag could not reach significance, and M7's acceptance would be a number with no verdict possible.
- **The most frequent codes.** TS2322 is in 36 chunks, too many anchors to review, and frequent codes are the ones a model is most likely to know.
- **The repository's `typescript` 6.0.3, or 7.0.2.** The first is not the version the docs were written against, and the second is outside twoslash's range.
- **Measuring rerank on the compiled index.** It costs an hour of the free trial, and no hypothesis reads it.
