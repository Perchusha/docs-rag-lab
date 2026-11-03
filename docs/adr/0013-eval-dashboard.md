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

No number appears twice. Per-tag tables, per-question diffs, the cited chunks and the list of runs sit behind one disclosure, closed by default, with tabs inside, and their data loads only when it opens. Tests hold this: all three sections fit 1280 by 800 without scrolling, for a calibrated report and for one that is not, and the first screen has 3 tab stops.

Labels are plain, by the M3 rule: "Fully correct", "Right chunk in top 8", "Run to run (hybrid twice)" with values like "none" or "5 questions differ".

Details and "How this was calibrated" are disclosures: focus stays on the button, and what they open comes next in the tab order. Moving focus in is for the inspector, a side panel that opens away from what opened it.

### 2. Uncertainty sits next to every number

There are no footnotes. A number, its interval and its comparison are in one row.

- **A share** gets a 95% Wilson interval, like calibration (ADR-0012).
- **A mean** gets a 95% percentile bootstrap over questions: 10,000 resamples with a fixed seed. MRR is bounded and skewed, so a t-interval can pass 1, and the bootstrap is just as deterministic. ADR-0010 turned down a bootstrap for deciding a comparison, since a sign test needs no seed. This one only describes spread, and it decides nothing.
- **A comparison** shows the split, p and the verdict in words (ADR-0010).
- **Run to run** says how many questions differ between the two runs of hybrid. A question only one of the runs has counts as differing, since nothing vouches for it. A difference a row also shows against itself means nothing (ADR-0012, section 8). Retrieval repeats exactly, so it has no such column.
- **The graphic:** each interval is a dot with whiskers on a scale shared across the row, so overlap shows at a glance. Its header says what the scale runs over: a score of 0 to 2 is not plotted on a scale of 0 to 100%. The whole column is hidden from screen readers, header and cells together, so that every other cell keeps its own header, and the numbers stay as text beside it. Each column has its own shape, so state is never shown by colour alone, and the marks stay in forced colours.
- **Exploratory metrics** say so in words beside their name, and never reach the sentence that sums up a section.
- **Bias:** "may run high" stands next to every correctness number, including correct and grounded, which needs a 2, and the grades per question. It comes from the labels, not from the code (section 5).
- **No number for nothing:** a share of 0 or a mean of no values says "none to count", rather than 0.000 with an interval of nothing.

### 3. A number and its verdict measure the same thing

"All citations hold" counts answers in which every cited claim is supported, not claims, because claims within an answer are not independent: 241 of 243 would give an interval of 97% to 100%, which overstates what 40 answers can show. That this also removes one "better" verdict is a side effect, not the reason.

For the same reason, "Fully correct" is compared on whether each answer scored 2. The score from 0 to 2 keeps its own comparison in the details.

"Ahead" always means better. On "Wrongly refused" fewer is better, so its number counts refusals and its comparison counts the answers that did not refuse.

**A verdict that names a side has to clear the row's own noise.** ADR-0012 says a difference a row also shows against itself means nothing. Each side of a comparison can move by what a second run moved, so a named verdict whose margin is at most twice the row's run-to-run count reads as noise. Twice is a judgement: it calls ADR-0012's own case, 7 to 0 against 6 questions differing, noise, which is how that ADR reads it. It changes no verdict on the reports so far. The tables by tag apply the same rule, so a question never reads as noise on the first screen and as better behind it.

**A summary claims only what a verdict names.** It reads the verdicts of the rows that are not exploratory, and says which side is better on which row, and which are mixed. "No difference holds up" appears only when none of them says otherwise. "About as correct" needs noise against every RAG row, from the sign test itself: a gap that is merely not significant is not that, and neither is one the row's own noise took a verdict from. "What RAG adds is grounding" also needs the answers to show it, with the citations holding on most answers past the interval. Under a judge that is not calibrated, the summary says so first.

### 4. It only reads

The dashboard reads committed report files. It makes no API call, needs no key, and has no button that could spend anything. A run parameter is checked against the list of reports, so it cannot reach another path. A name that is not on the list says so, and the page says what it shows instead. Development runs are left out, like everywhere else that is about what the repository keeps (ADR-0010).

The trust section also says which commit the index is at. That reads one value through a connection that refuses writes: no migration, no embedding cache created, and nothing left behind. A SQLite read-only handle would be the obvious choice, but it leaves `-wal` and `-shm` files next to a WAL database. An index that is missing, empty, held by a writer or no database reads as none that could be read. Like any SQLite connection, this one finishes what a killed writer left in the WAL, which changes no data.

One file that cannot be read loses only itself: the page names a report it cannot read or build and shows the next, a calibration it cannot read means not calibrated, and a verify record it cannot read means not checked. Parsing checks the outline of each, so what passes can be built.

`drl eval verify --record` writes what a re-run found next to the report, and the dashboard shows that, or says "not checked". It does not run anything itself.

### 5. Calibration comes from the labels

A calibration file now records the judge's model, the hash of each judge prompt and every disagreement. For a report, each dimension takes the latest blind round of the same judge whose prompt matches, so changing a prompt or the judge shows as "not calibrated" by itself. Latest means by report, and on one report the first round before a fresh one, which holds whatever order the files are listed in. The bias counts correctness disagreements over all blind rounds of that judge, because the first round's lean did not go away with the prompt.

A report's markdown and the CLI's summary use the same words. Labels come after a report, so `drl eval calibrate` writes the markdown of every named report with answers again, and only that: the JSON is the record and stays as it is. A calibration's own markdown speaks of its round, and whether the judge is calibrated for a report is left to that sentence. Labels of a development report count for no report the store reads, and the command says so.

### 6. Where the code lives

`core` builds plain data, `contracts` types it, and `ui` renders it with no logic of its own beyond formatting, as the inspector does with traces. So the intervals and verdicts are unit tested without a browser, and the stories replay real data from the final report.

## Consequences

- A calibration file from before this has no prompts and no disagreements. The three in the repository were written again from their labels, which is free.
- `eval/reports/<source>/` now also holds `*-calibration*.json` and `*-verify.json`. The store tells them from reports by name, so `--name` refuses a name that would read as one of them.

## Alternatives considered

- **A t-interval for means.** It can pass the range of the metric, and needs a "~" to be honest.
- **Showing only shares.** MRR would then have no uncertainty beside it, or would go.
- **A button to run verify.** It would end "only reads", and the index may not be at the report's commit anyway.
- **Everything on one long page.** That is the admin panel again.
