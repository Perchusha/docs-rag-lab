# Journal

Short notes per milestone, with before/after numbers where they exist. Newest first.

## M5 - The retrieval runs, and the gate that vetoed them (2026-11-04)

A reranker over the fused top 20 gave the largest retrieval gain this project has measured, and under the rules fixed before the run it is not accepted. Both of those stand. Answers are still to come, so this is retrieval only (ADR-0014).

| On 40 questions, primary anchors | Hybrid, M4 | Hybrid + rerank | Contexts | Contexts + rerank | Prefix from headings |
|---|---|---|---|---|---|
| hit@1 | 19 | 31 | 22 | 33 | 17 |
| hit@8 | 36 | 39 | 35 | 39 | 36 |
| MRR | 0.657 | 0.867 | 0.693 | 0.886 | 0.634 |
| Target rows met, of 5 | 2 | 4 | 3 | 3 | 2 |

- **The reranker:** significantly better on hit@1 (0 / 12 questions) and MRR (0 / 18), and no question got worse on any retrieval metric.
- **The verdict:** not accepted. The ADR asked for all five target rows, and ts-0033 stayed at rank 3 against a target of 1. The criteria do not change after a result.
- **The lesson:** a hard per-question gate let one question veto a significant, regression-free set-level gain. In future ADRs, set-level criteria decide and per-question targets are diagnostics.
- **The contexts:** on these docs, where every chunk already carries `document > sections`, the Haiku contexts added nothing significant, alone or on top of rerank. They cost $0.28 and about an hour of embeddings. Nor does `drl eval compare` call them better than a prefix written by code from the headings.
- **The backtick-weighted BM25 candidate from M4:** failed. It moved ts-0033 and ts-0004 up, and ts-0027 from 9 to 10, which the criterion does not allow. Its code stays behind the tag `exp/m5-h5`.

Writing the criteria first did its job: nobody could move the bar after seeing 0.867. What it cannot do is make a badly shaped gate a good one, and that is the part to fix next time, before the run.

**Spend:** Haiku $0.28. Voyage 834,600 rerank tokens and 929,495 embedding tokens, inside the free tokens, with no bill. No call of the 80 reranks met a 429, at about a minute each.

## M4 - The eval harness is done (2026-11-03)

Before M4, every claim about retrieval quality rested on a handful of searches run by hand. Now each strategy has a measured row, with its uncertainty beside every number, and a report anyone can run again.

| | Before M4 | After |
|---|---|---|
| Evidence for a claim | A handful of searches (M2) | 40 questions and 5 the docs do not answer, frozen at set version 1 |
| What a number comes with | Nothing | A 95% interval, a comparison question by question, and a verdict |
| Answers graded | None | Rows 0, 2 and 3, by a judge that a human checks without seeing its verdicts |
| Reproducible | No | `drl eval verify`: the final report byte for byte on the same vectors, and the baseline's conclusions on other vectors, from a clean worktree with no data |
| Where to read it | Terminal output | `/eval`: three questions on one screen, and the rest behind one button |

| Row | Right chunk in top 8 | MRR | Fully correct, may run high | All citations hold | Cost per answer |
|---|---|---|---|---|---|
| 0, Claude without RAG | no retrieval | no retrieval | 36 of 40 (77-96%) | cannot: no docs | $0.004 ($0.004-0.005) |
| 2, vector | 36 of 40 (77-96%) | 0.751 (0.63-0.86) | 36 of 40 (77-96%) | 38 of 40 (83-99%) | $0.022 ($0.021-0.022) |
| 3, hybrid | 36 of 40 (77-96%) | 0.657 (0.55-0.76) | 34 of 40 (71-93%) | 33 of 40 (68-91%) | $0.023 ($0.022-0.023) |

Correctness may be slightly inflated in every row: all 3 disagreements with the human are the judge scoring higher.

**What it showed:**
- **Hybrid is not measurably better than vector here,** on retrieval or on answers. It stays the default until M5, by the owner's decision.
- **The two fixes M2 pointed at did not work.** Tested under criteria fixed first, they won some questions and lost others, so the code stays behind a tag.
- **Without any docs, Claude is about as correct as RAG on this set.** Correctness alone cannot show what RAG adds here. What it adds is grounding, and a v2 of the set needs questions memory cannot answer.

**The dashboard needed more care than the numbers.** People decide from a page like this, so a claim the data does not support is the worst bug it can have.
- **Two review passes found 23 defects.** A false refusal counted as ahead, so the side that refused more could read as better. Summaries said "what RAG adds is grounding" even at 0 of 40. A report under another judge could show as calibrated. A slow response could replace the run the picker named. A score of 1.850 was drawn at 185% of its scale.
- **Three things only the real app or CI showed.** The live run found a contrast failure on every dark screen: Storybook paints the page body and the app did not, so a page that forgot its background passed in one and failed in the other. CI's wider Linux font took the first screen to 819 px, and pushed it sideways at 320 px. The chat's new link made 8 tab stops where the M3 pass had 7.
- **The two environments now agree,** by a test across every app, and the marks are checked under forced colours in CI, in Playwright's emulation.

**Spend:** $8.20 of Claude at list prices over all of M4. The acceptance run's full index added $0.03 of Voyage. The final run read 180 answers and 345 verdicts from the cache, for $0.00.

**Next:** M5, rerank and contextual retrieval as new rows. Three targets from M2 are still unmet, and the reranker is the next lever.

## M4 - Answers, the judge and what this set can show (2026-11-03)

Rows 0, 2 and 3 answered the golden set, and an LLM judge graded them, with a human checking the judge (ADR-0012). The plain finding: **on this set, row 0 is about as correct as RAG, so correctness alone does not measure the value of RAG here. What RAG adds is grounding.**

| | Row 0, no RAG | Row 2, vector | Row 3, hybrid | Row 3, again |
|---|---|---|---|---|
| Correctness, 0 to 2, may be slightly inflated | 1.850 | 1.850 | 1.775 | 1.775 |
| Scored 2, of 40 | 36 | 36 | 34 | 34 |
| Correct and grounded, of 40 (exploratory) | cannot score | 31 | 28 | 32 |
| Refused correctly, of 5 | 5 | 5 | 5 | 5 |
| Cost per question | $0.0043 | $0.0216 | $0.0225 | $0.0225 |

- **Row 2 against row 3:** 3 to 0 on correctness, p = 0.25, not significant, on questions hybrid search handles worse. Hybrid stays the default until M5.
- **Correct and grounded** was defined after seeing the first results, so it is exploratory. It counts answers that score 2, have every cited claim supported, and cite an anchor. Row 3 differs from itself by more than it differs from row 2, so it does not separate them either.
- **The judge took two rounds.** The first missed the bar on correctness, at 10 of 12. The prompt now states the rubric outright, and a fresh blind round agreed on 9 of 10, within the 1 disagreement fixed beforehand. Refusal agreed on 15 of 15 and support on 8 of 8.
- **That pass says less than it seems.** The new prompt changed only 1 of 120 verdicts, and the fresh round would have come out the same without it. All three disagreements are the judge scoring higher than the human, so correctness may still run slightly high.
- **A review before anyone used the numbers** found four blocking defects, among them labels that could pair with the wrong answers, and one text getting two grades.

**A candidate for golden set v2, not now:** more questions whose answers changed after the models' training cutoff, which memory cannot answer. The cited chunks listed for review, 52 in the final report, wait for the same review.

**A candidate for M9:** on ts-0024, retrieval misses, so the grounded answer refuses while row 0 answers correctly. A second, agentic search is the natural fix.

**Spend:** $8.20 at list prices, against a plan of about $11. Answers $3.13, the judge $5.07.

## M4 - The two retrieval hypotheses, tested and not adopted (2026-11-03)

SPEC section 13 named two causes for hybrid's lost ranks. Both were tested on the full set under criteria fixed first (ADR-0011), alone and together. No config met the targets, so the defaults did not change, and the code stays out of main, behind the tag `exp/m4-h1-h2`.

| Hybrid, primary anchors | Control | H1 | H2 | H1+H2 |
|---|---|---|---|---|
| ts-0033, target 1 | 3 | 2 | 3 | 2 |
| ts-0027, target 6 | 9 | 14 | 9 | 14 |
| ts-0004, target 2 | 7 | 4 | 4 | 3 |
| hit@8 | 36 | 35 | 36 | 35 |
| MRR | 0.657 | 0.642 | 0.660 | 0.644 |

Every overall difference is noise. The useful part is the diagnosis: BM25 counted twice is real where the exact list repeats the keyword list, but where the keyword query also holds generic words, the exact list is the only keyword list that follows the question's topic. Removing it took ts-0035 from rank 1 to 11.

**Spend:** nothing. Every run read cached vectors. Going back to schema 3 meant rebuilding the index from main: 994 vectors from the cache, 0 embedded, 0 tokens, 5.4 s. The baseline then reproduced byte for byte, on the same vectors.

## M3 follow-up - A UX pass, before M4 (2026-11-02)

Trying the app in Chrome showed that it read like an admin panel: it showed someone asking a question everything it knows about retrieval. Now the chat comes first, and the inspector opens on demand. Five bugs went with it. Decisions are in ADR-0008, section 9.

| | Before | After |
|---|---|---|
| Tab stops before the first question | 14 (counted from the old form's markup) | 7 |
| Inspector on the first view | Always, with a paragraph explaining itself | Closed until asked for |
| Comparing Hybrid and Vector for one question | Choose in the form, press Search only, and the answer leaves the page | One click on the toggle: one `/api/search`, no `/api/ask`, and the answer stays |
| Labels shared by chunks of one document | 102, covering 231 of 994 chunks | 0 |
| Fences and asterisks shown as text in sources | Whole ```` ```ts ```` fences | None in the 4 live answers, and no raw bracket or bold in any preview of the index's 8,115 blocks |
| Numberings for one chunk | 2: "citation 1" could say "Show chunk 2" | 1: "Source N" in the chat and all four tabs |
| Lone citation markers | A marker alone after a code block | None in the 4 live answers, and a story on a derived fixture |
| Stories, each a test in Chromium with axe in light and dark | 28 | 73 |

**Parts came at no cost:** `CHUNKER_VERSION` 4 forced a re-parse of 3.4s and 0 tokens. The keyword index, every embedding and the chunk text stayed byte-identical (`665fa74c8077a848`, `d2f55731ce8a7ba5`), and 20 of 20 M2 searches came back with the same rankings and contexts. The part in the title sent to Claude adds about 7 tokens per split chunk. The recorded answers have 0 to 6 such chunks of 8, against about 8,000 input tokens.

**Still shared:** 2 labels across 4 chunks, because upstream gives two pages the same title: `TSConfig Option: exclude` and `include`, under `options/` and `options/typeAcquisition/`. They are separate documents, with their own locations and links, so this PR leaves them.

**Checked on the live app, over the real index.** The paid run came before the review's fixes; a second run on the final code replayed the recorded answer for each question, with real searches, and gave the same results.
- The 4 example questions, each with "How was this found?", all four tabs and the toggle. Search only with edited text sent one `/api/search`, and neither it nor the toggle sent an `/api/ask`.
- axe found nothing in 42 states: empty, Search in open, answers, the panel on each tab, vector, 320 and 390 px wide, and dark.
- A keyboard-only run from the input to the panel and back, with a visible focus style at every stop.
- 63 of 64 checks passed. The last was my check for Next's indicator, which matched 3 empty 0 by 0 elements: nothing shows in the screenshots.

| Question | Sources | Cost |
|---|---|---|
| In which version did `satisfies` appear? | 1 | about $0.017 (its usage line was not captured; the recorded one is $0.0171) |
| What does error TS2345 mean? | 5 | $0.0251 |
| What does the `strict` flag enable? | 4 | $0.0219 |
| ts-0004, in Russian: what is the difference between `unknown` and `any`? | 4 | $0.0237 |

Total spend for this pass: about $0.21, of which $0.1202 went on 6 recordings while planning.

**What was surprising:**
- **A citation could not get focus back.** The first story for it failed: focus landed in the input. The markdown component map depended on `onCitation`, so a new callback built a new map, and React remounted the whole answer, citation included. The same thing happened during streaming each time a new citation arrived, and scrolled code boxes lost their place. The map is now a constant, and what a citation needs comes through context.
- **A double focus ring that no story could see.** `outline: none` on the input ties with the global `:focus-visible` rule, and the later rule wins. Storybook and Next load CSS in a different order, so it only showed on the live app, in a screenshot.
- **The lone marker was my own fix from the last PR.** It stopped a citation from turning the rest of an answer into code by giving the marker its own line. Five recording attempts could not reproduce the shape, so that one story uses a real answer with one event moved, and the file name says so.

**What the code-reviewer subagent caught.** All checks passed, and every commit typechecked. It drove the live app with intercepted calls, and changed the code to see which tests would notice. Three findings blocked the PR:
- **Enter on a "Search in" checkbox sent the half-written question,** because the checkboxes sit inside the chat's form. That spends money on a key a disclosure of options invites. Enter now toggles the box.
- **The input could hide what had focus,** though ADR-0008 said it never did. The page kept a fixed 10rem clear and the input grows further: with ten lines in it, 10 of 45 Tab stops were wholly hidden at 1280 by 800. The page now keeps the input's measured height clear, and a story tabs through a long answer to prove it.
- **Tests that could not fail.** Of 10 changes it made to the code, 9 survived the whole suite, including every abort in the fresh search. The race story could not see a race: its gate released the older search first, and the replay rejected it on abort anyway. The product behaved correctly in all but the scroll padding above; only the protection was missing. Each of these changes now fails a story, except a guard in `useAssistant` that no test could reach, which is gone: the reducer already does that.

It also found:
- **Previews on the real index:** of 3,404, 90 showed only a heading, 46 were cut inside a link and 18 ended in an empty or stray code box. My four live answers had shown none of it.
- **The marker rule counted fence lines,** so a 3-tick block holding a ```` ```ts ```` line still turned the rest of the answer into code, the very bug the rule exists to prevent. Now one scanner reads fences a line at a time, for markers and previews both. It agrees with a real CommonMark parser on every line of the 994 chunks and 5 recorded answers.
- **A double click on Send stopped the question it had just sent,** and the select stayed open over the input when the keyboard left it.
- **Streaming got slower with each question,** from 5 ms per event at the first to 50 ms at the sixteenth, because every delta parsed every earlier answer. It is now under 10 ms.
- **A second question landed low on the page,** with its answer streaming below the input.
- **Moving between answers kept the sort and "Show all",** although the panel promised a clean start.
- **Docs that said more than the code:** "never hides", "valid markdown", one numbering (the Document tab still said "in context #3"), and the part wording. The code changed where it could, and the wording where it could not.

It also pointed out that Safari reports `isComposing` as false on the Enter that confirms a word. The input now checks `keyCode` 229 as well.

**A second review, of the fixes.** They added real logic, so the code-reviewer ran again on those commits, with its own mutants and live probes. It found one blocker and more of what the first review had started:
- **A double click on Stop sent the half-written question.** The first click stopped the answer and made the button a submit. The earlier fix had covered only Send. A second click now does nothing, on either role.
- **The scanner did not read fences "as CommonMark reads them", as I had written.** It disagreed with a parser on 21 of 41 odd inputs, and on some a marker showed as literal text in code. Three small rules bring that to 9, with no change on real text, and the docs now say what it is: a line scanner.
- **"This is great!" lost its citation:** the marker made `![1](#cite-1)`, an image, so the reader saw "great1" and no button. That one predates this branch, and an answer can easily end that way.
- **Previews on the real index, again:** 8 ended in a stray `!...`, and 4 of the 17 tables lost their delimiter row and showed raw pipes. Now none does.
- **Paths no test covered:** a real fetch rejects when aborted, but every late-result story used a replay that does not. Leaving the page stopping the stream, which guards money, had no test either.
- **With the panel stacked, a new question still landed low,** because the panel has no height until its trace arrives.

**CI caught what the Windows run could not.** After the walk in `InputNeverCoversFocus` was widened to every stop, it failed on the Linux runner in both schemes and passed here. A table box is 556 px tall there, with wider fonts, and does not fit above an input with ten lines in it. The product was right: WCAG 2.4.11 asks only that it is not entirely hidden. The story now holds what fits to being whole, and a taller box to being partly visible.

The streaming change held up: a citation arriving after its marker turns it into a working button, and a focused marker keeps focus through a stream. So did the claim that the reducer alone drops late events.

Left as they are, because they are rare and do not show on the index: a marker after indented code or a reference definition line, and previews that take `*ptr` or `__dirname` for open emphasis and stop there.

## M3 - The ts-docs app and the retrieval inspector (2026-11-01)

The second M3 PR adds the ui package, Storybook and the Next.js app on top of the engine from the first. `pnpm dev` now opens a TypeScript docs assistant: ask on the left, see on the right how the answer's context was chosen. Decisions are in ADR-0008.

**What exists now:**
- A streamed answer, rendered as markdown, with numbered citation buttons. A citation opens the Context tab on its chunk and moves focus there.
- "Search only": the retrieval without a Claude call.
- The inspector:
  - **Fusion:** each candidate's rank and score in the vector, keyword and exact lists, its RRF score, what each list added to it, and how far fusion moved it from its vector rank;
  - **Lists**, **Context** (the chunks as sent, with the cited ones marked) and **Document** (the selected chunk's document, every chunk boundary in order).
- The app listens on 127.0.0.1 only, and its three routes are one line each over tested handlers.

**The acceptance criterion, "the inspector shows candidates, scores and chunk boundaries",** checked on the real index. For `satisfies`, a banner says BM25 counts twice for 6 of the top 8 chunks, and those rows say "BM25 x2". The vector search's top hit (TypeScript 4.9 > The satisfies Operator) shows "down 2" at fused rank 3. That is the first M4 hypothesis, now visible per question instead of reconstructed from `drl search` output.

**The four conditions from the M3 approval:**

| Condition | How it is met | Checked by |
|---|---|---|
| Localhost only | `next dev` and `next start` take `--hostname 127.0.0.1`; Storybook takes `--host 127.0.0.1` | `netstat`: `127.0.0.1:3000` and `127.0.0.1:6006` only |
| Safe markdown | No rehype-raw; default URL sanitizing; only http(s) links, with `rel="noopener noreferrer"`; images as alt text | 6 unit tests on server-rendered HTML; every citation link in the live app has the rel |
| Accessibility | A text marker beside the two BM25 shades; a real table with `aria-sort` on button headers; WAI-ARIA tabs; a polite status region instead of a live answer; no animation under reduced motion | 28 stories, each a test in Chromium with axe in light and dark (56 runs, 0 violations); axe on the live app in 15 states, including every tab at 320 px, 0 violations |
| Keyboard play tests | Sorting with Enter and Space; tabs with the arrow keys, Home and End; one tab stop | The KeyboardSorting and KeyboardTabs stories, plus a keyboard-only run of the live app: Tab to an example, Enter, Ctrl+Enter to ask, Tab to the citation, Enter |

**Measured in the app,** over the real index with cached query vectors:

| | |
|---|---|
| Retrieval inside the route (trace `totalMs`) | 5.6-7.7 ms for the 4 questions |
| `POST /api/search` under `next start`, warm | 22 ms |
| First event (the trace) after the request | 32 ms |
| First answer text after the request | 3.1 s through the route; 1.5 s in the engine run that recorded the fixture. Claude's latency varies between runs |
| Whole answer | 4.0-5.2 s |
| JavaScript on first load (`next start`) | 176 KB transferred, 590 KB decoded, 6 files |
| `next build` | 5.2 s |

| Question | Sources | Cost |
|---|---|---|
| In which version did `satisfies` appear? | 1 | $0.0170 |
| What does error TS2345 mean? | 4 | $0.0238 |
| What does the `strict` flag enable? | 3 | $0.0214 |
| ts-0004, in Russian: what is the difference between `unknown` and `any`? | 5 | $0.0236 |

Every citation links to a typescriptlang.org page, with the section anchor where the chunk has one.

**What was surprising:**
- **axe in dark mode caught the test setup, not the components.** The first dark run failed 8 stories: the components drew dark-mode text on Storybook's white canvas. The app paints its own background, so the stories now get the same page colours. Running axe in both schemes is what made the mistake visible.
- **The first story run with an empty Vite cache failed every story.** Vite discovered react-markdown mid-run and reloaded the page. CI always starts with an empty cache, so `react-markdown` is now pre-bundled.
- **The Sources list had lost its numbers, and no test noticed.** The items were flex boxes, and a flex box drops its list marker, so the [1] in the answer matched nothing visible. axe has no rule for it. It showed up only on a screenshot of the live app; a story now checks that each source is a numbered list item, and fails without the fix.
- **A rank cell read "19.16"**: rank 1 and score 9.16 in two block spans have no space between them in the text, which is also what a screen reader gets. Visually hidden text now makes it "1, score 9.16". A keyboard play test caught it.
- **TypeScript blue fails AA.** `#3178c6` reaches 4.4:1 on white. The theme is now a light and a dark shade (`#235a97`, `#79b8ff`), and the tokens story checks every text colour on its backgrounds in both schemes.
- **`pnpm dev` through turbo would have hidden shell API keys.** Turbo's strict env mode passes only declared variables to a task, so only the dotenv file would have worked. `pnpm dev` and `pnpm storybook` call pnpm directly.

**What the code-reviewer subagent caught.** It ran in a fresh context, ran every check, and probed the live components with its own Playwright scripts. Two blocking findings:
- **A citation kept stealing focus.** After a citation click, every return to the Context tab moved focus to the old chunk, and the arrow keys in the tab list stopped working. The reveal request outlived its use: ContextView remembered it had handled it, but the panel unmounts when another tab is selected. DocsAssistant now clears the request once it is handled, and the AskAndInspect story leaves the tab and comes back.
- **One commit did not typecheck on its own.** `git rm` of the app's placeholder had been staged early and went into an unrelated ui fix, leaving the app's tsconfig with no input. The branch was rebuilt with the deletion in the app commit, before anything was pushed.

It also found:
- **A citation after a code block turned the rest of the answer into code**, because the marker landed on the closing fence line. It now starts its own line.
- **The selected chunk was shown by colour alone**, and its buttons were `aria-pressed` toggles that never untoggled. It now has `aria-current` and a visible "selected" label.
- **No test for a new question replacing a running one.** The first version of the story passed even with the abort removed: the reducer drops late events once the search finishes, which hid the leak. With a search slower than the whole stream it fails without the abort.
- **Smaller fixes:** `ask()` also stops when the response body is cancelled, not only on the request signal; mid-stream failures are logged; the engine builds the source `rag.config.ts` names; chunk locations no longer assume the TypeScript-Website layout; the tab list leaves Alt+Arrow to the browser.

**Three more changes before the merge, after reading the PR:**
- **Tables.** remark-gfm is on, and each table and code block scrolls in a focusable, named box. Recording one real table answer ($0.0238) paid for itself. axe flagged the empty corner header that comparison tables use, and it raised a marker case no test had: placed after a row's last pipe, a marker becomes an extra cell, which GFM drops along with the citation.
- **A test that lasted 15 ms was not fixed by making it last 400.** The earlier fix moved the check to a longer delay, which only made the race rarer. A `ReplayGate` now holds each step until the test releases it. It also made the race story stronger: the replay keeps sending after its abort, so removing the check that drops late events now fails in under 300 ms, where the timer version could not catch it at all. All 111 ui tests passed 4 runs in a row with the CPU oversubscribed (32 busy loops on 16 cores), taking 58-85 s against about 5 s.
- **Reflow at 320 CSS px.** The chat and the inspector already stacked, but the page was 550 px wide. No visible element stuck out: the fusion table's visually hidden text is absolutely positioned, and it escaped its scroll box because the box was not positioned. The new story found that on its first run. A screenshot found what geometry cannot: a sentence in the table's caption that needed sideways scrolling to read.

A restart also turned up something unrelated. Windows reserves port ranges for Hyper-V at each boot, and one of them now covered Vitest's default browser port, so the story tests failed with `EACCES`. They use a fixed port below that range now.

**Hook timings (ADR-0002).** On a forced cache miss, the post-edit check takes 8.4-8.5 s for ui and 6.6-8.0 s for ts-docs: ui is just over the 8 s budget. The hook's own runs while this PR was built had a median of 4.5 s for ui, so lint stays in PostToolUse. ui's lint moves to the Stop hook first if a typical run passes 8 s.

| | |
|---|---|
| Tests | 385 offline in the product packages (232 after the first half): contracts 22 (0), ui 111 (55 unit, 56 story tests: 28 stories in light and dark), ts-docs 20 (0). Tooling: config 20, claude-hooks 85, repo-checks 14 |
| ui test task | 11.5 s with Chromium; 5.0 s of it is Vitest |
| Spend | $0.1437: two recorded answer fixtures ($0.0171 and $0.0238), four asks in the app ($0.0858), one time-to-first-token run ($0.0170). 29 Voyage tokens |

### Open items for M4
- The eval harness, reports and the dashboard view (a new ui view, with its stories).
- Check the two hypotheses on the full golden set. The fusion view shows the double counting per question; the eval shows whether removing it helps.
- ui's post-edit check is just over the 8 s budget on a forced cache miss; re-measure when the dashboard lands.

## M3, first half - The engine under the app (2026-11-01)

M3 is two PRs. This one prepares the packages the ts-docs app will sit on, and is verified through the CLI and the real index. The second adds the ui package, the Next.js app and the M3 entry above.

**What exists now:**
- `@docs-rag-lab/contracts`: the retrieval trace, the answer events and citations, a document's chunks. It imports nothing, so ui may use it (ADR-0006).
- `@docs-rag-lab/settings`: every model ID, price and limit, as plain data with no secrets, shared by the CLI and every app. API keys are read only inside the provider constructors (ADR-0007).
- `ask()` reports an answer as events (trace, text, citation markers, done with tokens and cost), and `createEngine()` gives the CLI and the apps one code path for search, ask and document lookups.
- Citation titles name the section a chunk starts in.
- A CLAUDE.md rule, with a command: every commit must pass typecheck on its own.

**The spike came first.** A throwaway Next.js 16.4 app in a separate worktree ran `retrieve()` over a copy of the real index, in `next dev` and in `next build && next start`:
- opening the index takes 3-7 ms per request and retrieval 5-8 ms, so opening it per request is fine;
- sqlite-vec has to be a server external package. Bundled, it fails at runtime with `tR.resolve is not a function`. better-sqlite3 is on Next's default list, and pnpm needs no extra dependencies;
- an NDJSON stream from a route reaches the client chunk by chunk, and a client disconnect fires the request's abort signal. That is why `ask()` takes an `AbortSignal`;
- `next dev` writes an `AGENTS.md` into the app, which contains an em dash and would fail `format:check`.

Nothing in it changed the engine API beyond the abort signal.

**Packed chunks are cited by their section.** A pack of sections takes its parent's heading path, which is empty under the document root, so the answer cited "TypeScript 5.9" for the section on notable behavioral changes. Chunker version 3 records the section each chunk starts in:

| | Before | After |
|---|---|---|
| TS 5.9 chunk with the `TS2345` output | TypeScript 5.9 | TypeScript 5.9 > Notable Behavioral Changes |
| `jsdoc-supported-types.html#template` | JSDoc Reference > Types | JSDoc Reference > Types > @template |
| `typescript-3-7.html#dom-changes` | TypeScript 3.7 > 3.7 Breaking Changes | TypeScript 3.7 > 3.7 Breaking Changes > DOM Changes |
| Citation titles that changed | | 243 of 994: 170 packs under the document root, 73 under a section |
| Cost of the forced re-parse | | 3.0s, 0 tokens. 994 chunks unchanged; the keyword index and every embedding byte-identical |

The trace carries the same field, `chunks[id].sectionPath`, so `TRACE_VERSION` is now 2. Nothing stores traces before M4.

**Nothing else moved.** All 20 M2 searches (the 10 before/after questions, vector and hybrid) return the same fused rankings and the same contexts. One `drl ask --verbose` through the engine cost $0.0169.

**What was surprising:**
- **The plan was wrong about document order.** It said chunks had no document-order column, and proposed a migration. In fact `chunks.ordinal` is the chunk's place in its document: it runs 0..n-1 in all 248 documents. The number inside the chunk ID is a different one, the pack's place in its section, and that is what the plan had read. The migration was dropped before anything was pushed; SPEC and the db types now say which ordinal is which.
- **No npm import had ever reached a boundary rule.** The new `contracts-client-safe` rule needs to see npm imports, and saw none: the `exclude` pattern matched `node_modules` and `dist/`, which removes modules from the graph, not just from traversal. So `no-non-package-json` could never fire. Now 20 npm modules are in the graph, nothing new fails, and a fixture proves the rule fires.
- **`git stash` is no tool for a mutation test** when the change adds untracked packages: the tracked half disappears, `pnpm` reinstalls without the new packages, and the stash no longer applies over the new lockfile. It came back after discarding the lockfile change. Mutation checks now edit the one line under test instead.

**What the code-reviewer subagent caught.** It ran in a fresh context, ran every check and the per-commit typecheck (all 7 commits passed, none rewritten), and probed the boundary rules on a scratch tree. No blocking issues. It found:
- **A hole in `core-settings-types-only`.** dependency-cruiser counts `import { type Settings } from ...` as type-only, but with `verbatimModuleSyntax` Node still loads the module: the reviewer proved it with a `console.log` in a probe module. The ESLint preset now has `no-import-type-side-effects`, which no file in the repo violated.
- **Docs that contradicted the code:**
  - `apps/CLAUDE.md` still said model IDs live in `rag.config.ts`, which is exactly what the app PR would have followed;
  - ADR-0005 and ADR-0006 still said `TRACE_VERSION` 1;
  - SPEC still said "config only".
- **Invariants without a test where they could break:** that ingest stores `sectionPath` (dropping it would have fallen back silently), and that an answer failing part-way keeps its usage. Both now have tests; the first fails when ingest drops the field.
- **Engine input checks.** The engine checked doc types but not strategy or top K, and an app forwards whatever a browser sends. It now throws `InvalidRequestError` for each, and a missing index throws `IndexNotFoundError`, which the CLI shows without the stack-trace hint.
- **Smaller fixes:** `contracts-client-safe` would have flagged a contracts test importing vitest; two copies of `spansOf`; the usage summary spread unchecked fields.

| | |
|---|---|
| Tests | 232 offline (204 in M2): db 28, source-kit 40, source-typescript 41, core 94, cli 25, settings 4 |
| Boundary rules | 4 new (`contracts-is-leaf`, `contracts-client-safe`, `settings-is-leaf`, `core-settings-types-only`), each with a violating fixture; 19 rule tests |
| Spend | $0.0169 (one answer); 0 Voyage tokens |

### Open items for the second half
- The ui package (chat, citations, the inspector with its fusion view) and Storybook with the a11y addon.
- The Next.js app, bound to 127.0.0.1, with `sqlite-vec` in `serverExternalPackages` and `agentRules: false`; ADR-0008 records the spike.
- Re-measure the post-edit hook for ui and the app (ADR-0002).

## M2 - Hybrid search and the retrieval trace (2026-10-31)

**What exists now:**
- keyword search: SQLite FTS5 with the trigram tokenizer, over the heading path, context and text of every chunk, kept in sync by triggers;
- hybrid retrieval: vector search, BM25 over the question's words, and BM25 over its exact tokens (code in backticks, camelCase identifiers, `--flags`, `TS2345`), fused with Reciprocal Rank Fusion;
- doc type filters inside the KNN query (a sqlite-vec metadata column) and the keyword query;
- a retrieval trace: every candidate list with ranks and scores, the fused ranking, the final context and timings. `drl ask --verbose` prints it, and the new `drl search` prints it without calling Claude (`--json` for all of it);
- a parser version in the manifest, so a parser change re-parses on its own.

Before M2, retrieval was vector-only (M1). The design and the measurements behind it are in ADR-0005.

**Before/after.** `drl search --strategy vector|hybrid` over three groups of questions: the 7 `exact-token` questions of the draft golden set (`eval/questions.draft.jsonl`, not reviewed yet), the 3 journal questions from M1, and one cross-lingual question. Each cell is the rank of the best anchor chunk; the top 8 go to the answer.

| Question | Vector (M1) | Hybrid (M2) |
|---|---|---|
| ts-0028 `noUncheckedIndexedAccess` | 3 | 2 |
| ts-0029 `exactOptionalPropertyTypes` | 1 | 2 |
| ts-0030 `verbatimModuleSyntax` | 1 | 2 |
| ts-0031 `isolatedModules` | 1 | 1 |
| ts-0032 `skipLibCheck` | 1 | 2 |
| ts-0036 `--erasableSyntaxOnly` | 1 | 1 |
| **TS2345** (ts-0040, the M1 journal question), handbook anchors | **not in top 50** | **6** |
| **TS2345**, the TS 5.7 and 5.9 sections that print the error | **not in top 50** | **3** |
| `satisfies` (journal) | 1 | 3 |
| `strict` (journal), `strict.md` | 1 | 1 |
| `strict` (journal), the compiler options table | 6 | 9 |
| ts-0004, in Russian: `unknown` vs `any` | 2 | 7 |

An anchor chunk reaches the answer for 9 of 10 questions with vector search and 10 of 10 with hybrid. Hybrid takes 6-10 ms with a cached query vector. Nothing was tuned on these questions: RRF k=60, equal weights and 50 candidates per list are the usual defaults, and M4 tunes them on the full set.

**TS2345, before and after:**
- M1: "The search results don't define error TS2345 directly, so I can't give you an official explanation of it."
- M2 cites the TypeScript 5.9 release notes, whose compiler output reads `error TS2345: Argument of type 'ArrayBufferLike' is not assignable to parameter of type 'BufferSource'`, and concludes: "In short, the error message reads 'Argument of type X is not assignable to parameter of type Y'." It cost $0.0236.

**What hybrid made worse.** It is not a free win, and the traces show why:
- `satisfies` dropped from 1 to 3 and the Russian question from 2 to 7. Both stayed in the top 8.
- For `strict`, the compiler options table fell from 6 to 9, out of the context. The answer still lists the four options from the 2.3 notes, but now says "the search results don't explicitly state that `strict` enables" `strictPropertyInitialization` and `strictBindCallApply`. M1's answer had them from that table.
- The cause: a backticked plain word (`satisfies`, `strict`, `unknown`, `any`) is both a search term and an exact token, so BM25 counts twice in the fusion, and in the trigram index `strict` also matches every `strictX` option. Limiting exact tokens to code-shaped ones is an M4 question, decided on 40 questions, not 10.

**The tokenizer was measured, not guessed.** BM25 only, on an in-memory copy of the index; the count is how often the anchor document lands in the top 8:

| | unicode61 | porter | unicode61 + split camelCase | trigram |
|---|---|---|---|---|
| 7 `exact-token` questions | 7/7 | 7/7 | 7/7 | 7/7 |
| 10 partial option names ("unchecked index access option") | 5/10 | - | 8/10 | **10/10** |
| 6 paraphrases that name no part of the option | 5/6 | 4/6 | 5/6 | 5/6 |

Trigram costs 6.2 MB of index instead of 1.0 MB, and 0.8 ms per query instead of 0.3 ms.

**The index upgrade cost nothing.** Migrations ran in place, first on an in-memory copy of the real index, then on the real file:

| | Result |
|---|---|
| Migration 2 (keyword index, doc type column, parser version) | 218 ms. 994 vectors before and after, with the same SHA-256 over every embedding: copied, not re-embedded |
| FTS5 integrity check against the chunks table | ok, about 45 ms. It also runs inside every sync |
| First sync after it | `parser version changed from none to 1`: 248 files re-parsed, 994 chunks unchanged, **0 tokens, 2.2s** |
| Second sync | incremental, 0.9s, 0 tokens |
| Index on disk | about 14 MB compacted (7.5 MB in M1). The file here is 21 MB, 7 MB of it free pages left by the migrations, which later writes reuse |
| Tests | 204, all offline (153 in M1): db 26, source-kit 39, source-typescript 41, core 71, cli 27 |
| PostToolUse hook per edit | 2.3-3.4s (the budget is 8s) |
| M2's own API spend | 88 Voyage tokens (7 new query embeddings) and $0.0627 for the three `drl ask` answers |

**A bug that only real data showed.** The first full rebuild after migration 2 grew the keyword index from 6.2 MB to 9.0 MB, and the file from 14.2 MB to 19.3 MB:
- A sync upserts every chunk of a parsed document, and the update trigger re-indexed all of them, changed or not.
- Migration 3 adds a `WHEN` clause and merges the index segments, which brings the index back to 6.2 MB.
- A later `--full` re-parse left it at exactly 6,174,420 bytes.
- The unit tests had passed both before and after the fix; a new test now counts index segments.

**What was surprising:**
- **The docs do contain `TS2345`,** in 2 chunks: the TS 5.7 and 5.9 release notes print the compiler output. They are the only place in the corpus that shows the message. The draft anchors for ts-0040 pointed only at handbook examples, so two anchors were added. The handbook chunks write the code as `// @errors: 2345` (27 chunks), never as `TS2345`.
- **`error_codes` is per document, not per chunk.** 181 chunks in 15 documents "contain" 2345 through that metadata, against the 27 chunks that hold the directive. Matching on that metadata would have been 7x coarser than the text. Per-chunk compiler metadata belongs to M7.
- **RRF punishes a strong signal from a single list.** With two lists, BM25 put a TS2345 handbook anchor 5th, but vector search did not have it in its top 50, so the fused rank was 12th: chunks that both lists found at middling ranks beat it. A third list over the exact tokens alone brought it to 6th.
- **vec0 cannot add a column in place,** so the doc type column meant copying 994 vectors through a temporary table, with the dimensions read from the old table's SQL.
- **Source filtering needed no column.** There is one index file per source, so `--source` already picks the file. Searching several sources at once comes with the second source in M6.

**What the code-reviewer subagent caught.** It ran in a fresh context before the PR. It reproduced all 12 rows of the before/after table offline from cached query vectors, and it found no bugs in the SQL, FTS5, sqlite-vec, migration or RRF code. One of its probes proved that a failed migration 2 rolls back completely. It found these:
- **`TypeScript` and `JavaScript` counted as exact tokens.** The identifier rule took any inner capital.
  - `TypeScript` matches 831 of 994 chunks, so for 9 of the 40 draft questions the exact list was ranked by chunk length alone, with full weight in the fusion.
  - Outside backticks, only camelCase counts now. None of the 10 measured questions changed rank.
- **The journal entry was not committed** when the review started. It is now.
- **Docs that no longer matched the code:**
  - the sync step in SPEC did not list the parser version as a rebuild reason;
  - ADR-0004 still said parser changes need `--full`;
  - `packages/sources/CLAUDE.md`, which loads when Claude edits a parser, did not say to bump `parserVersion`;
  - SPEC did not say how an anchor matches a chunk when its section is packed inside a bigger chunk. 17 of the 43 `#` anchors in the draft set are such sections, including both new ts-0040 anchors.
- **Tests that did not prove their claim:**
  - the empty-exact-list test rebuilt the implementation's own fusion call; it now compares against a real run whose exact list comes back empty;
  - a comment said bare `OR` and `NOT` are searched as words, but they are stopwords;
  - `drl search --json` had no successful run; a test now seeds an index and a cached query vector.
- **Smaller fixes:**
  - `--top-k` above 4096 reached sqlite-vec's raw error; it is now capped at 100;
  - `--json` was accepted by every command; it now works only with `search`;
  - a vector with a stale doc type would have blocked every sync with no way to repair it. Kept vectors now get their document's doc type on every write, so `--full` heals it. A full re-parse takes 1.9s instead of 1.7s.

### Open items for M3
- The trace type lives in core, and `ui` may not import core. Decide whether it moves to a contracts package when the inspector needs it.
- Model IDs and prices still live in `packages/cli/src/drl.config.ts` (ADR-0004). The first app needs the same values.
- A chunk that packs several sections can get an empty heading path but a section anchor. The TS 5.9 chunk is cited as just "TypeScript 5.9", anchored at `#notable-behavioral-changes`. The inspector shows chunk boundaries, which makes this the time to look at it.

### Open items for M4
- Win back the three hybrid regressions while TS2345 stays in the top 8: the targets and the two hypotheses to check (backticked plain words counted twice, trigram matches of 3-character terms) are in SPEC section 13. Measure on the full golden set, together with RRF k and list weights; the M5 reranker is the next lever.
- Graded relevance: the TS 5.7 and 5.9 sections show the TS2345 message but not its cause, which the handbook anchors explain.
- Review and approve the draft golden set, then rename it to `questions.jsonl`.
- Version and block type filters (SPEC section 9) are not built yet.

## M1 - TypeScript ingest and CLI (2026-10-31)

**What exists now:** the first end-to-end RAG path, over the TypeScript docs.
- `drl sync typescript`:
  1. a shallow, sparse git clone of TypeScript-Website;
  2. a markdown parser;
  3. a heading-tree chunker;
  4. Voyage embeddings through a shared cache;
  5. a sqlite-vec index.

  Later syncs re-embed only chunks whose text changed.
- `drl ask`: vector search, then Claude Sonnet 5.5 answers from `search_result` blocks with native citations to typescriptlang.org sections.
- Every command that calls an API ends with the tokens it used and their cost at list prices.

Before M1 there was no RAG code. After it, the index looks like this.

**The index.** TypeScript-Website `v2` at `205122bb`:

| docType | Documents | Chunks | Estimated tokens |
|---|---|---|---|
| handbook | 18 | 131 | 69,711 |
| reference | 20 | 180 | 98,797 |
| option (tsconfig) | 137 | 144 | 37,252 |
| release-notes | 48 | 454 | 252,933 |
| other (declaration files, project config, JS) | 25 | 85 | 47,342 |
| **Total** | **248** | **994** | **506,035** |

Release notes are 46% of the chunks and half of the tokens.

**Chunk sizes, in estimated tokens:**
- percentiles: p10 218, median 532, p90 736, max 1,046;
- 827 of 994 chunks (83%) fall between 300 and 800;
- 28 chunks are under 100, mostly one-paragraph tsconfig options;
- 12 are over 800:
  - 2 are single code blocks, which may not be split (1,046 and 824);
  - 10 are 802-810, because the 800 budget counts the blocks, and the heading-path prefix line comes on top.

**Numbers.** Windows 11, Node 26.13.0, Voyage `voyage-4` on the MongoDB Atlas free trial (3 requests and 10K tokens per minute):

| What | Result |
|---|---|
| Full index | **1h 09m 35s**, of which **1h 07m 51s (97.5%) was waiting on the rate limiter**. 186 requests, no restarts |
| Tokens | 426,167 billed by Voyage, against 506,035 estimated locally (billed/estimated 0.84) |
| Full index cost | **$0.0256** at list price ($0.06 per MTok); **$0 actual**, because Atlas includes free tokens |
| Second sync, nothing changed | **0.9s, 0 tokens, $0** |
| Index on disk | `typescript.sqlite` 7.5 MB, `cache.sqlite` 4.7 MB |
| One `drl ask` | $0.017-0.020: about 7-8K input tokens (8 search results), 121-616 output tokens, at `low` effort. The query embedding costs 8-10 tokens |
| Live URL check | All 248 documents (247 distinct pages) return 200. All 675 chunk anchors exist as ids on their pages |
| Tests | 153 new, all offline: db 14, source-kit 38, source-typescript 38, core 44, cli 19 |
| Conformance | Passes over 8 byte-for-byte fixtures, and over all 248 files in a dry run |
| PostToolUse hook per edit | Median about 2.7s and max 3.6s on a cache miss, 1.0s cached. It was 2.6s and 3.0s on the scaffold; the budget is 8s |

**Three answers, as `drl ask` printed them.** Each runs with `--verbose`, which also lists the 8 retrieved chunks.

> **What does error TS2345 mean?**
>
> The search results don't define error TS2345 directly, so I can't give you an official explanation of it.
>
> The only related detail is in the `checkJs` documentation. Its example, which calls `parseFloat(3.142)` even though parseFloat only takes a string[1], is annotated with `// @errors: 2345`. With `checkJs` turned on, you get error messages from the JavaScript file.[1] This suggests TS2345 is tied to passing an argument of the wrong type to a function, but the results never say so.
>
> The "Understanding Errors" page also describes the general rule that when calling a function, each argument's type must be _assignable to_ parameter's declared type.[2] ...
>
> [1] TSConfig Option: checkJs, https://www.typescriptlang.org/tsconfig/checkJs.html
> [2] Understanding Errors, https://www.typescriptlang.org/docs/handbook/2/understanding-errors.html

- The best match had cosine distance 0.62, and none of the 8 retrieved chunks names TS2345 in its prose. Vector search alone cannot match an exact token like an error code.
- Claude said so, as the system prompt asks, and labeled its inference as an inference.
- This is the baseline for BM25 in M2 and for compiler-verified error codes in M7.
- Cost: $0.0172.

> **In which version did `satisfies` appear?**
>
> The `satisfies` operator was introduced in TypeScript 4.9.[1] TypeScript 5.0 later added a JSDoc `@satisfies` tag that does exactly the same thing[1] for JavaScript code type-checked with JSDoc annotations.
>
> [1] TypeScript 5.0 > @satisfies Support in JSDoc, https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-0.html#satisfies-support-in-jsdoc

- The top 4 hits were the 4.9 and 5.0 release-note sections.
- Claude cited the 5.0 page, whose first sentence says "TypeScript 4.9 introduced the `satisfies` operator."
- Cost: $0.0174.

> **What does the `strict` flag enable?**
>
> The `strict` flag enables all strict type-checking options[1]. ... The TypeScript 2.3 release notes list these: `strictNullChecks`, `noImplicitAny`, `noImplicitThis`, and `alwaysStrict`[2]. ... The compiler options reference shows that these options also default to `true` when `strict` is on: `strictBindCallApply`, `strictBuiltinIteratorReturn`, `strictFunctionTypes`, `strictNullChecks`, `strictPropertyInitialization`, `useUnknownInCatchVariables`[3]. ...
>
> [1] TSConfig Option: strict, https://www.typescriptlang.org/tsconfig/strict.html
> [2] TypeScript 2.3 > New --strict master option, https://www.typescriptlang.org/docs/handbook/release-notes/typescript-2-3.html#new---strict-master-option
> [3] tsc CLI Options > Compiler Options, https://www.typescriptlang.org/docs/handbook/compiler-options.html#compiler-options

- Citation [3] quotes a row of the 282-row HTML options table, which the parser turns into one line per row with cells joined by ` | `. It printed as "`--strictBindCallApply` | `boolean` | `true` if `strict` ; `false` otherwise". The stray space before the semicolon was a closing `</a>` turned into a space. That was fixed, which made the real-data test below possible.
- Best distance 0.46.
- Cost: $0.0199.

**Incremental sync on real data.** The `</a>` fix changed the parser but not the upstream docs, so `drl sync typescript --full` re-parsed all 248 files:

| | Result |
|---|---|
| Documents | 1 modified, 247 unchanged |
| Chunks | **6 changed, 988 unchanged** |
| Re-embedded | **6 chunks, 3,892 tokens, $0.0002, 2.6s** |

The other 988 kept their vectors. The acceptance test proves the same property on a fixture repository; this is the same property on the real corpus.

**What was surprising:**
- **The free trial, not the docs, sets the pace.** 97.5% of the first index was spent waiting. The sync was bound by the 3-requests-per-minute limit more than by the token limit:
  - the local estimate is 19% above the billed count (billed/estimated 0.84), so batches averaged 2.7K estimated but only 2.3K billed tokens;
  - that used only about 6.1K of the 10K tokens allowed per minute;
  - batches of about 3.6K estimated tokens (about 3K billed) fill the token budget, so the next full index should take about 50 minutes instead of 70. **The free-trial cap is now 3,600 estimated tokens**, chosen from this measured ratio of 0.84 (ADR-0004, section 7).
  - A payment method on the Atlas org (Tier 1) would cut the index to about a minute, and the free tokens would still apply.
- **Atlas reported 0 tokens for the one-word query "hello",** so the first smoke test failed on an assertion that tokens are above 0. A one-sentence input reports 24. The keys were fine; the test now embeds a sentence.
- **The free-trial limits come in an `x-api-warning` header,** not in standard rate-limit headers. `drl limits` prints it.
- **Upstream line endings vary.** About 10 files are stored with CRLF, including `Everyday Types.md`. This machine also has `core.autocrlf=true`, which would have rewritten the checkout and every hash. The fix has three parts:
  - text is normalized at read time;
  - the clone stores `core.autocrlf=false`;
  - fixtures are marked `-text`.
- **Markdown hides things.** `TypeScript 5.0.md` wraps two whole sections in an HTML comment that the site does not render, and the parser drops them the same way. The tsc options page is one 282-row HTML table, now one text line per row.
- **The chunker had to move.** SPEC put chunking in core, but the conformance suite runs inside each source and must chunk, and sources may import only source-kit. The chunker moved to source-kit. The embedding cache went to core, so source-kit is now a leaf (ADR-0003).
- **Packages may not import apps,** so `drl` cannot read an app's `rag.config.ts`. Model IDs and prices live in `packages/cli/src/drl.config.ts` until M3 (ADR-0004).
- **The new Anthropic SDK** (1.3.0) sends API version `2026-10-21`, which rejects `temperature`. The answer request sets effort instead.

**What the code-reviewer subagent caught.** It ran in a fresh context before the M1 PR, with no blocking findings. It verified its claims with probes on local `file://` repositories and a 3,000-document chunker fuzz, which found no ID collisions, empty chunks or split code blocks. It found these:
- **A changed repository URL indexed the old repository under the new URL.** The checkout fetched its original `origin`. It now re-clones when `origin` differs, with a two-repository test.
- **Two doc claims did not match the data.** "Every chunk over 800 is a code block": 10 of the 12 are prefix overshoot. "Checks every chunk has exactly one vector": the code only compared totals; it now also counts chunks without a vector.
- **A full rebuild stamped every document with the new head** as its `last_changed_sha`. That would have broken staleness in M4. The column now moves only when content changes.
- **The retry tests did not cover what their names said:**
  - no test for 5xx backoff or for giving up;
  - the cache-persistence test would pass even if the cache were written at the end.
  
  Both are now real tests, plus a 5-minute cap on Retry-After, and a failed attempt now counts 0 tokens in the limiter.
- **Smaller fixes:**
  - a fence line with an info string closed a nested fence (CHUNKER_VERSION 2);
  - a greedy comment regex could drop visible HTML between two comments;
  - `@errors` codes could run into the next line;
  - env errors skipped the usage line;
  - a failed answer stream lost its usage;
  - stack traces now need `DRL_DEBUG=1`;
  - dead code was removed.
- **After the fixes,** the CHUNKER_VERSION bump forced a full rebuild: 248 files re-parsed, 994 chunks unchanged, 0 tokens, 1.6s. None of the fixes changed a chunk of the real corpus.

### Open items for M2
- Keyword search (FTS5 with BM25) for exact tokens like `TS2345` and option names. The TS2345 question above is the first test case.
- A `doc_type` filter: release notes dominate the corpus, and 6 of the 8 hits for `satisfies` came from them. sqlite-vec metadata columns can pre-filter, and rebuilding the vector table costs no tokens, because the vectors come from the cache.
- The retrieval trace object.
- Free-trial batch size: the cap is now 3,600 estimated tokens. Measure the next full index against the estimated 50 minutes, or add a payment method.
- Parser changes need `--full` today: the manifest records the chunker version, but not a version of each source's parser. Add a source version to the manifest so a parser change forces the re-parse by itself.

## Before M1 - Permission deny rules (2026-10-31)

**What changed:** `.claude/settings.json` now denies reads of dotenv files at any depth. Every path rule, for dotenv files, `data/` and `.cache/`, is anchored to the project root with a leading `/` (ADR-0002, section 5).

**Probes (Claude Code 2.1.287, each one a real tool call):**

| Probe | Before | After |
|---|---|---|
| Write `packages/core/src/data/x.ts` | denied by `Edit(./data/**)` | allowed |
| Write `packages/core/src/.cache/x.ts` | denied by `Edit(./.cache/**)` | allowed |
| Write `data/probe.txt`, `.cache/probe.txt` | denied (M0) | denied |
| Read 5 dotenv names at the root, all except `.env` (not on disk) | not probed | denied |
| Read all 6 dotenv names in `packages/core/` (not on disk) | not probed | denied |
| Read `.env.test` at the root and `apps/.env.local`, after a shell `cd` into `packages/core` (not on disk) | not probed | denied |
| Read `.env.example` | readable | readable |

**What was surprising:**
- **`./data/**` is not anchored.** Per the docs, a deny rule with one directory segment matches that directory at any depth, so the M0 rule blocked any source folder named `data`. A leading `/` anchors it.
- **Settings reload live.** The new rules applied to the next tool call in the same session.
- **A shell `cd` does not move the `/` anchor.** After `cd packages/core`, the root dotenv probes were still denied.
- **This time, auto mode allowed narrowing a deny rule.** The user asked for that exact change, unlike the refused M0 demo.

## M0 - Scaffold (2026-10-31)

**What exists now:**
- a pnpm + Turborepo monorepo with 7 package shells and 2 tooling packages;
- shared TypeScript, ESLint and Vitest presets;
- dependency-cruiser boundary rules that run on every lint;
- GitHub Actions CI;
- three Claude Code hooks that catch mistakes while Claude is still editing.

There is no RAG code yet. M0 is the floor the rest of the project stands on.

**Numbers (Windows 11, Node 26.13.0, pnpm 12.16.1):**

| What | Result |
|---|---|
| `pnpm install`, warm store | 5.9s, 174 packages (5.4s in a fresh clone) |
| `pnpm turbo run lint typecheck test`, cold | 14.5s, 31 tasks (23.8s in a fresh clone on a second drive) |
| Same, fully cached | 1.2s (30 of 31 cached; the boundary check is never cached) |
| Boundary rules | 12 architecture rules plus 3 hygiene rules. Each architecture rule is proven against deliberate violations (14 tests, 30 fixture files) |
| Hook unit tests | 85 (guard matrix, path forms, workspace lookup, failure modes, loop guard) |
| PostToolUse hook per edit | 2.6s median and 3.0s max on a cache miss, 1.1s warm (budget: 8s) |
| Boundary violation caught by the hook | 1.0s after the edit |
| Stop hook catching a broken test | 1.0s |
| CI on the M0 PR | green, 36s job ([#1](https://github.com/Perchusha/docs-rag-lab/pull/1), [run](https://github.com/Perchusha/docs-rag-lab/actions/runs/41195983216)) |
| CI on a deliberate boundary violation | red after 17s, on `ui-no-internal-packages` ([#2](https://github.com/Perchusha/docs-rag-lab/pull/2), [run](https://github.com/Perchusha/docs-rag-lab/actions/runs/41196021149)) |

**Proofs (each break reverted):**
- CI: throwaway draft PR [#2](https://github.com/Perchusha/docs-rag-lab/pull/2) made `ui` declare and import `@docs-rag-lab/core`. The `pnpm turbo run lint typecheck test` step failed with `error ui-no-internal-packages: packages/ui/src/index.ts → packages/core/src/index.ts`. The PR was then closed unmerged.
- `ui` imported `@docs-rag-lab/core`. The PostToolUse hook answered with `ui-no-internal-packages: packages/ui/src/index.ts -> packages/core/src/index.ts` and the SPEC reason.
- A type error (TS2322), an `any`, and an `eslint-disable` with no explanation were each sent back by the same hook.
- Reading or printing a dotenv file was denied. `.env.example` stayed readable.
- Writes to `data/` and `.cache/` were denied. The permission deny rules caught them first; the hook covers the same cases, as its tests and a direct run show.
- A deliberately broken test blocked Claude from finishing, until it was fixed.
- A boundary violation made through the shell, which skips PostToolUse, was caught by the Stop hook.
- An em dash added to the README failed `format:check` with `README.md:104:12`.

**What the code-reviewer subagent caught.** It ran in a fresh context before the M0 commit and verified each finding with a probe:
- **Every boundary rule could be laundered through the config package.** `ui` re-exporting core through a file in `packages/config` passed with 0 violations, because every rule exempts config so packages can load presets. Fixed with a `config-is-leaf` rule and a fixture.
- **The secret guard missed `.ENV`** (NTFS is case-insensitive), **`cat<.env` and `Get-Content README.md,.env`.** Fixed: case-insensitive matching and a wider boundary set, with a test for each case.
- **The Stop hook did not check boundaries at all,** so shell edits could slip past every hook. Fixed: `test` now depends on the boundary check.
- **Other fixes:**
  - a broken `package.json` crashed the post-edit hook silently;
  - `.gitignore` would have hidden any nested `src/data/` folder;
  - several doc claims were inaccurate.

**What was surprising:**
- **TypeScript 7 is out, but this project can't use it yet.** typescript-eslint, dependency-cruiser and twoslash all need the JS compiler API, so the project stays on 6.0.3 (ADR-0001).
- **pnpm 12 is a native binary.** Node 22's corepack can't run it, and Node 26 doesn't ship corepack, so `npm i -g pnpm` it is.
- **pnpm now refuses packages less than a day old.** It quietly wrote an exception for eslint 10.14.0. We pinned `^10.13.0` instead and kept the protection.
- **The secret guard blocked its own author.** A commit message that named a dotenv file was denied. That false positive is accepted, and documented in ADR-0002.
- **Claude Code's auto mode refused to let the agent loosen its own permission rules** for a demo. Good.

### Open items for M1
- Confirm that Node type stripping works for the `drl` CLI importing workspace packages through pnpm symlinks. A probe during the M0 review ran successfully on Windows; confirm it with real code. The fallback is `tsx`.
- Decide where the embedding cache lives (source-kit or core), and revisit the `source-kit-only-db` rule.
- Re-measure the PostToolUse hook once packages contain real code.

### Open items for M4
- Committed eval reports may quote doc text that contains U+2014; react.dev uses it. Decide then: exclude `eval/reports/**` from the em-dash check, or normalize dashes when reports are written.
