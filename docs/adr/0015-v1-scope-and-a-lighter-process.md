# ADR-0015: The scope of v1.0, and a lighter process from M6

- Status: accepted. Section 6 was added on 2026-11-06, when M7 closed.
- Date: 2026-11-04
- Milestone: M5, for what comes after it

## Context

M4 and M5 built what every later row needs: an eval harness, reports that reproduce, a judge a human has checked in three blind rounds, and a dashboard that reads all of it. Building them took most of the project's process: 45 questions reviewed twice, 40 blind labels, about $16 of Claude, and ADRs that fix every hypothesis first. That was right for building them. Repeating all of it per source would cost more than it would show.

The owner decided the scope and the process below on 2026-11-04, when M5 closed.

## Decision

### 1. v1.0 is M5 through M9

On top of M0 to M4, which are done: M5 rerank and contextual retrieval, M6 React, M7 the twoslash compile, M8 the interview-prep MVP and M9 agentic mode. M10, the MCP server and more sources, moves to "later" in SPEC section 13. It is not dropped, and it has no date.

### 2. From M6 on, reuse what exists

The eval harness, the calibrated judge and the dashboard are reused. A milestone adds a source or a row. It does not rebuild them.

### 3. React gets a smaller golden set

- **20 questions: 16 answerable and 4 the docs do not answer,** instead of TypeScript's 40 and 5. Of the 16, 10 are fresh, one of them in Russian, 2 more are in Russian, and 4 are others.
- **Fresh questions are picked strictly by the docs' own dates,** walking back from the pinned commit, never by whether the no-RAG row gets them wrong, which would bias the result. They are where RAG might finally beat Claude's memory. ADR-0016 has the walk.
- **Claude drafts them, and the owner reviews only the flagged ones.** A draft is flagged when:
  - its answer or its anchor took a judgement call: the docs text leaves room, or the passage spans sections;
  - the docs do not answer it, where only a person can say that nothing covers it;
  - its wording copies a heading or a sentence from the docs, which gives keyword search a head start, as in M4;
  - its answer depends on a version or a default that changed, the stale-page risk of ts-0039 and ts-0017.
- **The rest of ADR-0009 holds:** the format, the anchors, the lock, the freeze, and the rule for changing a frozen set. `drl eval check --accept` writes the lock after that review of the flagged questions.

### 4. No new calibration unless the judge changes

A new round of blind labels is needed only when the judge's prompt or model changes. A new source changes neither: the judge's prompts name no source. For React, a spot check on 10 answers is enough. It asks whether the judge behaves on docs it has not graded before. It is no calibration round, so ADR-0012's bar of 13 of 15 does not apply. What the spot check has to show is in ADR-0016, with M6's hypotheses.

### 5. What does not get lighter

- **Hypotheses and criteria are written down before any paid run.** A result cannot shape what counts as success.
- **Set-level criteria decide, and per-question targets are diagnostics** (ADR-0014).
- **A command that spends prints its estimate first** and waits for `--yes`.
- **Every number keeps its interval and its verdict,** reports stay reproducible (ADR-0010), and a frozen set stays frozen.

### 6. From M8 on, one main hypothesis and 3 to 4 PRs

The owner decided this on 2026-11-06, when M7 closed. M7 tested a chain of three hypotheses, C1 to C3, with two spot checks of the judge, over five PRs.

- **One main hypothesis per milestone,** with set-level criteria written down before any paid run. No chains of sub-hypotheses.
- **M8, the interview-prep app, is a product milestone.** It is judged mainly by the owner's hands-on review, plus the usual checks: tests, stories, axe and the keyboard. An eval runs only for a part that depends on retrieval or generation quality, and it stays small.
- **M9, agentic mode, is measured on the frozen sets only,** TypeScript's version 3 and React's version 2, with no new questions. The calibrated judge is reused. A spot check of 10 answers runs only if the answer format changes in a way the judge has not seen.
- **Each milestone aims for 3 to 4 PRs.**

Section 5 still holds.

## Consequences

- **20 questions resolve less than 40.** The smallest significant split stays 6 to 0, but fewer questions can move, and most tags will have 5 questions or fewer, which the reports already call too few. A React row can show a large difference and little else. `fresh` has 10 so that it is not one of those tags.
- **The set is weighted towards new pages.** Ten of the 16 answerable questions come from the newest parts of the docs, so its overall numbers do not describe the docs at large.
- **React's numbers rest on less review.** Wherever they appear, they say that Claude drafted the set and a person reviewed the flagged questions. React's numbers and TypeScript's are never compared.
- **M6 has code to change.** A report reads the judge's calibration from its own source's folder, so a React report would find no rounds and say uncalibrated. It has to read the rounds for the same prompts and model, whichever source they came from. `drl eval label` takes 15 answers for a first round, and its fresh round of 10 needs an earlier report of the same set, so the spot check needs its own way to pick 10. And the latest blind round under the same prompts decides calibration, while the bias counts every blind round, so the spot check has to be stored where that rule does not read it. Otherwise it would decide for TypeScript's reports too.
- **Older text changes.** SPEC section 10 said a human approves every question and that each milestone touching eval labels about 15 answers, and `packages/sources/CLAUDE.md` said the first. ADR-0009 and ADR-0012 stand for TypeScript's set and for any change to the judge. This decision is about React: a later source would be decided when it comes.

## Alternatives considered

- **40 questions for React, as the SPEC had it.** More power, and comparable effort to TypeScript's set, which took two human reviews. The owner chose the smaller set.
- **A full calibration round for React.** It would check the judge on new docs with more answers, but the prompts and the model are the same, and the last round passed.
- **Keeping M10 in v1.0.** The SPEC already called the MCP server a bonus milestone, and nothing before it depends on it.
