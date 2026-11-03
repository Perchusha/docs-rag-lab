# ADR-0013: The eval dashboard

- Status: accepted
- Date: 2026-11-03
- Milestone: M4

## Context

SPEC section 3 asks for runs per source and strategy, metrics, diffs between runs and stale questions. ADR-0010 and ADR-0012 say what the numbers mean, and how little some of them show. The M3 UX pass showed what happens otherwise: the app read like an admin panel, showing someone everything it knew. So this is planned against overload from the start.

## Decision

### 1. The first screen answers three questions

1. **Does hybrid find the right chunks more often?** Retrieval only.
2. **Does it give better answers, and does RAG help at all?** All three rows, with their verdicts.
3. **Can these numbers be trusted?** The judge's calibration and known bias, the set version, the docs commit, the verify status.

No number appears twice. Per-tag tables, per-question diffs, the cited chunks and the list of runs sit behind one disclosure, closed by default, with tabs inside, and their data loads only when it opens. Tests hold this: all three sections fit 1280 by 800 without scrolling, and the first screen has 3 tab stops.

Labels are plain, by the M3 rule: "Fully correct", "Right chunk in top 8", "Run to run (hybrid twice)" with values like "none" or "5 questions differ".

### 2. Uncertainty sits next to every number

There are no footnotes. A number, its interval and its comparison are in one row.

- **A share** gets a 95% Wilson interval, like calibration (ADR-0012).
- **A mean** gets a 95% percentile bootstrap over questions: 10,000 resamples with a fixed seed. MRR is bounded and skewed, so a t-interval can pass 1, and the bootstrap is just as deterministic. ADR-0010 turned down a bootstrap for deciding a comparison, since a sign test needs no seed. This one only describes spread, and it decides nothing.
- **A comparison** shows the split, p and the verdict in words (ADR-0010).
- **Run to run** says how many questions differ between the two runs of hybrid. A difference a row also shows against itself means nothing (ADR-0012, section 8). Retrieval repeats exactly, so it has no such column.
- **The graphic:** each interval is a dot with whiskers on a scale shared across the row, so overlap shows at a glance. It is hidden from screen readers, because the numbers stay as text beside it. Vector and hybrid differ by shape, so state is never shown by colour alone.
- **Exploratory metrics** say so in words beside their name, and never reach the sentence that sums up a section.
- **Bias:** "may run high" stands next to every correctness number, and it comes from the labels, not from the code (section 5).

### 3. A number and its verdict measure the same thing

"All citations hold" counts answers in which every cited claim is supported, not claims, because claims within an answer are not independent: 241 of 243 would give an interval of 97% to 100%, which overstates what 40 answers can show. That this also removes one "better" verdict is a side effect, not the reason.

For the same reason, "Fully correct" is compared on whether each answer scored 2. The score from 0 to 2 keeps its own comparison in the details.

### 4. It only reads

The dashboard reads committed report files. It makes no API call, needs no key, and has no button that could spend anything. A run parameter is checked against the list of reports, so it cannot reach another path. Development runs are left out, like everywhere else that is about what the repository keeps (ADR-0010).

`drl eval verify --record` writes what a re-run found next to the report, and the dashboard shows that, or says "not checked". It does not run anything itself.

### 5. Calibration comes from the labels

A calibration file now records the hash of each judge prompt and every disagreement. For a report, each dimension takes the latest blind round whose prompt matches, so changing a prompt shows as "not calibrated" by itself. The bias counts correctness disagreements over all blind rounds, because the first round's lean did not go away with the prompt. A report's markdown and the CLI's summary use the same words.

### 6. Where the code lives

`core` builds plain data, `contracts` types it, and `ui` renders it with no logic of its own beyond formatting, as the inspector does with traces. So the intervals and verdicts are unit tested without a browser, and the stories replay real data from the final report.

## Consequences

- A calibration file from before this has no prompts and no disagreements. The two in the repository were written again from their labels, which is free.
- `eval/reports/<source>/` now also holds `*-calibration*.json` and `*-verify.json`. The store tells them from reports by name.

## Alternatives considered

- **A t-interval for means.** It can pass the range of the metric, and needs a "~" to be honest.
- **Showing only shares.** MRR would then have no uncertainty beside it, or would go.
- **A button to run verify.** It would end "only reads", and the index may not be at the report's commit anyway.
- **Everything on one long page.** That is the admin panel again.
