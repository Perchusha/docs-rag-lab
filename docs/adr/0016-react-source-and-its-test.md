# ADR-0016: The React source, and what M6 tests on it

- Status: accepted as the test, before any React index, question or answer exists.
- Date: 2026-11-04
- Milestone: M6

## Context

M6 adds React through `/add-source`, with an app and a golden set of its own, under the lighter process of ADR-0015. This ADR fixes the test first, so that the result cannot shape what counts as success. Anything not written here is a separate hypothesis, written down first. The owner approved this plan on 2026-11-04.

## What is measured

| Row | Retrieval | Answers |
|---|---|---|
| 0, Claude without RAG | none | once |
| 2, vector | yes | once |
| 3, hybrid | yes | twice |
| 4, hybrid + rerank | yes | twice |

- **One index, at one pinned docs commit:** the head of `reactjs/react.dev` when the first full sync runs. That is `2177e28d3c3c16a8183346b9140f11ce0ee6af25`, of 2026-11-04, synced on 2026-11-05. Upstream has moved since, so any later sync of this index names that commit with `--at`.
- **Nothing is tuned.** Prompts, models, RRF, list depth and rerank depth stay as they are. A change to any of them is a new hypothesis.
- **No row 5.** On TypeScript the Haiku contexts added nothing significant on chunks that already carry their headings (ADR-0014), and React's chunks carry theirs the same way.
- **No row 1 or row 6.** Row 1 has never been measured, and row 6 is M9.
- **One named report,** with retrieval and answers in it.
- **React's numbers and TypeScript's are never compared.** They are different questions on different docs.

## The golden set

| Group | Questions | Tags |
|---|---|---|
| Fresh, in English | 9 | `fresh`, and others that fit |
| Fresh, in Russian | 1 | `fresh`, `cross-lingual` |
| In Russian | 2 | `cross-lingual`, and others that fit |
| Others | 4 | `basic`, `edge`, `exact-token` or `version` |
| The docs do not answer | 4, at least one with a false premise | `unanswerable` |

That is 16 answerable and 4 not, by the owner's decision. Ten fresh questions are there so that the `fresh` tag can show something: with 6, only 6 to 0 could be significant. With 10, so can 9 to 1, 8 to 1 and 6 to 0 with 4 tied, while 8 to 2 cannot.

### The walk that picks the fresh questions

Fresh questions are picked strictly by the docs' own dates, never by whether row 0 gets them wrong, which would bias the result. So the picking is mechanical, and there is no window to choose:

1. At the pinned commit, list every indexed page and every heading with the date of the commit that first added it, by git history, following renames. Newest first. Ties go in path order, then document order.
2. Go down the list. Each page or heading gives at most one question, tagged `fresh`, until there are 10. One page gives at most 2 of them, counting its heading entries with it, so the 10 come from at least 5 pages.
3. Skip an entry only for one of four reasons, and record it: it was moved or reworded and is not new; it holds no fact that one passage can check; it is the same feature as a question already taken; or its page has already given 2.
4. The fifth question of the walk is the one asked in Russian, so that this choice does not depend on the question either.
5. The walk, with each skip and its reason, is committed with the draft.

**Why at most 2 per page.** One new page can fill the top of the list: on TypeScript, 29 of the newest 50 entries came from one release note. Without a limit, `fresh` could describe one or two pages. The owner set this limit before any walk on React, since deciding it after seeing that walk would mean choosing the rule by the data. It can push the tenth question further back, which is reported anyway.

If the survey of the docs finds that pages state dates of their own, those dates replace the commit's, and this section says so before the walk runs. **The survey found none:** the frontmatter has no date field, and no page states a date in its text. The only years are in links to blog posts and in example data. So the commit's dates stand. Fresh means newest in these docs. It does not mean past the answering model's training cutoff, and how far back the tenth question goes is reported. If row 0 knows all of them, that is the result.

`drl eval check --draft` holds the limit of 2 per page: it counts the `fresh` questions by the pages of their anchors, and fails above 2. The owner asked for this on 2026-11-05, so that the rule does not rest on reading `fresh-walk.md`.

**A heading that only lost a badge is reworded, not new.** The commit that prepared the site for React 19.3, of 2026-09-09, took `<CanaryBadge />` off 10 headings, `FragmentInstance` and `use(browser())` among them, so the walk's dates list them as new. The walk looks for new facts on the page, and removing a badge adds none about how the API works. Counting them would make R1 test whether the model knows a status changed, which is a much narrower question. The owner decided this on 2026-11-05, after the walk had run and with no retrieval or answer seen. It keeps the reading the walk had already used, so no question changed.

### A fresh question about an API that is not stable

The newest pages of react.dev often describe unstable APIs. So the owner added this on 2026-11-05, before any walk on React. If a fresh question is about an API on any non-stable release channel (canary, experimental, release candidate or beta), its expected answer states that status, and an answer that omits it cannot be fully correct. The owner worded it by channel so that none has to be decided case by case.

- **What counts is the documented release channel of the React API itself, inherited from its parent page, not an incidental mention.** The owner set this principle on 2026-11-05, before any walk on React. The docs document a channel through a page's `version` frontmatter, a box such as `<Experimental>`, or a badge on the item. At the pin that is 3 experimental pages (`experimental_taintObjectReference`, `experimental_taintUniqueValue`, `react-devtools-cdt-mcp`), the release candidate page `eslint-plugin-react-hooks` with its 17 pages under `lints/`, `<ExperimentalBadge />` on `<Suspense defer>`, and `<CanaryBadge />` on `importMap`. No page, box or badge says beta, and a `version` the parser does not know stops it.
- **The owner's rulings on the three cases that principle was asked for.** The 17 `lints/` pages inherit the RC status of their parent page, since they are rules of the RC plugin. A version pinned in an example's `package.json`, such as `"react": "beta"` in `useTransition`, does not count: it is example config, not the status of the API the question is about. `TanStack Start (Beta)` in `creating-a-react-app` does not count: it is another project's status.
- **The `answer` alone would not do it.** The judge's prompt says that "details the question did not ask for do not count either way", and the prompts do not change. So such a question also has a `note`, which reaches the judge as its grading note and the owner on the label sheet. It says that the status is part of what a fully correct answer gives, and that an answer without it scores at most 1. Nothing in the prompts changes, so ADR-0015's reason for no new calibration still holds.
- **It holds with no exception, even where the question is not about stability.** The owner decided this on 2026-11-05 for react-0002, which asks whether the tool goes in an MCP client's config: a question about setting up an experimental tool should get an answer that says it is experimental.
- **Two cases of known grade try this path,** which the owner asked for on 2026-11-05, in `drl eval judge-check` and in react-0002's words. Its expert answer without the last sentence, the status, has to score 1: the judge gave 1, and its reasoning named the note ("It omits that the API is experimental, and the grading note caps that at 1."). The expert answer itself has to score 2, or the note would only cap every answer: the judge gave 2. That was one call each, $0.0101 in all. The answer that scored 2 is the expert's, word for word, so these cases do not show how the judge treats a status given in other words.
- **The status of a `lints/` page does not carry over to a question about React's behaviour.** The owner ruled on this on 2026-11-05 for react-0011 and react-0012, which are about what React does, not about the lint rules, although a `lints/` page says the same thing. Their notes say so, and neither is a fresh question.
- **Every such question is flagged** for the owner, with its note.
- **A row that reads the docs can state the status, except from a `lints/` page alone.** The site shows a page's `version` beside its title, and the parser puts it in the title, which starts every chunk of that page. A badge stays as words in its item, and a box stays a callout. A `lints/` page has no `version` and does not mention the channel, in its text or on the site, so a row states that status only if it also read the parent page.

### Drafting and freezing

- **From the docs' text only.** No `drl search` and no `drl ask` while drafting: anchors found by looking at what the retrievers return favour those retrievers (ADR-0009).
- **Flags** are ADR-0015's. The copied wording is checked by a script as well as by reading: a run of 4 or more words shared with a heading or the anchored passage, or a whole heading, counts. A single identifier such as `useState` does not.
- **Other passages were searched for before the freeze.** A search for key words in the docs' text, with no retrieval, found passages on 7 of the questions that the draft did not list. The owner decided each one, by ADR-0009's rule for an acceptable anchor, and 6 of the questions got new anchors. `questions.review.md` has the decisions. Such a search may miss passages, so a report can still list a cited chunk as a candidate for review.
- **Frozen before any row answers.** After the owner has reviewed the flagged questions, `drl eval check --accept` writes the lock, the set is version 1 in ADR-0009's changelog, and the rule for changing a frozen set applies.
- **No `targets.json`.** Set-level criteria decide, and this set has no per-question targets (ADR-0014).
- **The app's example questions stay out of the set,** and the app's smoke test asks one of them. They were picked before any walk, and a reader could copy them from the page.

**What this weighting does.** Ten of the 16 answerable questions come from the newest parts of the docs. So the overall numbers describe a set weighted towards new pages, not the docs at large, and the README says so beside them.

## Hypotheses

All on primary anchors or on the 16 answerable questions, with the verdicts the reports already give (ADR-0010).

### R1: does RAG beat Claude's memory on the newest docs?

Row 3 against row 0, on fully correct, on the `fresh` tag.

**Shown if** the verdict names row 3 and its margin passes twice row 3's own run-to-run count on that tag, ADR-0013's rule. The split and the ties are reported either way, with "may run high" beside them, and so is the same comparison on all 16.

It decides what the README may say, and nothing else.

### R2: does rerank repeat its retrieval gain on other docs?

Hybrid against rerank, on all 16.

**Repeated if** the verdict names rerank on both MRR and hit@1, and on each of hit@1, hit@3, hit@5, hit@8, recall@8 and MRR hybrid wins by at most 2 questions net and the verdict is not `mixed`. Any question whose anchor leaves the top 8 is named, even within noise.

It decides nothing for the chat. Vector against hybrid is reported the same way, and decides nothing either.

### R3: does that reach the answers?

Row 3 against row 4, on fully correct, all citations hold and wrongly refused.

**Reached if** a verdict names row 4 and its margin passes twice the larger run-to-run count of the two rows. Then the work stops and the owner is asked, since the reason the chat stays on hybrid would be open again. Otherwise hybrid stays, for this app too. Correct and grounded stays exploratory and decides nothing.

## The spot check of the judge

The prompts and the model do not change, so there is no calibration round (ADR-0015). The owner labels 10 answers blind, from a seed of their own: 3 from row 0, 4 from row 3 and 3 from row 4, 2 of them on questions the docs do not answer, with none on the same question twice.

- **It passes with at most one disagreement on each dimension it compares,** which is what ADR-0012's bar allows at 8 and at 12 compared.
- **A miss stops the work,** and the owner is asked. The prompt does not change without the owner.
- **It has a file of its own,** `<report>-spot-check.json`, which `judgeTrust` does not read, so it decides nothing for TypeScript's reports and does not enter their count of disagreements. React's report says that the judge was calibrated on TypeScript's answers and spot-checked here, and which way any disagreement leans.
- **The labels are committed at once,** under `eval/labels/react/`. M5's were nearly lost.

## What stops the work

The owner approved up to $10 of Claude for M6 with no separate stop before the answers. A pilot of 5 questions comes first, and the estimate still prints before anything is spent. The work stops, and the owner is asked, if:

- **Hybrid has the right chunk in its top 8 on fewer than 12 of the 16.** Before any answer, look for a fault in the parser or the chunks first. The set does not change because of a ranking.
- **The forecast for M6 passes $10.**
- **Voyage rejects a call,** by ADR-0014's rules. The only fallback stays a depth of 15.
- **The spot check misses,** or **R3 is reached.**

## Integrity checks

These come first. If one fails, the numbers are not read as a result.

1. **TypeScript stays as it is.** After each PR that changes shared code and at the end, `drl eval verify` on `2026-11-04-6b2d15f7-final` says byte for byte, and the plain index's sha256 still starts `403465a8`. The TypeScript parser and the chunker do not change.
2. **What the dashboard builds for every TypeScript report is unchanged,** apart from what a PR says it adds.
3. **The lock comes first.** The commit that freezes the set is an ancestor of the commit the report stamps.
4. **React's report reproduces:** `drl eval verify` says byte for byte.
5. **Every cited text is in that chunk's text,** as ADR-0014's check 7.

## What this needs built

**In the harness, before React:**
- `drl eval` embeds the queries in one batch before it plans its rerank calls, as a run does, and says so. Today it searches question by question, before its estimate (journal, open items for M6).
- A report reads the judge's rounds for its prompts and model from every source's folder, not only its own.
- `drl eval label --spot` for the sheet and `drl eval spot-check` for what it found, as above.

**For the draft,** in the skill's PR, since the walk and the check of copied wording have to be what they say:
- `drl eval walk` lists the walk's entries in the walk's order. A sync's checkout is shallow, so it keeps a clone of the history under the cache.
- `drl eval check --draft` says which anchors do not resolve and what each question copies from the pages it is anchored to, and it fails above 2 `fresh` questions on a page. A heading of one word counts only if it starts with a capital and has no other: a parsed heading has lost its backticks, so `memo` is an identifier and `Caveats` is not. A hit only sends a question to the owner.

**The source.** `packages/sources/react`, scaffolded with `turbo gen source`. `learn/` is doc type `handbook` and `reference/` is `reference`. It parses with the same pipeline as TypeScript's, plus `remark-mdx`. The components are surveyed first, as SPEC section 8 says, and "The source, as surveyed" below records what became of each, and what anchors the headings have. The TypeScript parser and the chunker are not changed for it.

**`packages/docs-server`.** About 280 lines of logic are in `apps/ts-docs/src/server`: the route handlers, the engine's one instance and the eval store. A second app cannot import them, since apps never import apps, and they are logic, which apps should not hold (ADR-0008). They move to a package that imports `core`, `contracts` and `settings`, with their tests and a boundary rule, and no behaviour changes. Each app keeps its config, theme, pages and one-line routes, and builds its own source, since the package imports none.

**Not built in M6,** by the owner's decision: the `run-eval` skill, the `eval-analyst` subagent and `turbo gen app`. M6's acceptance needs none of them, and the same commands run by hand.

## The source, as surveyed

From every file under `src/content/learn` and `src/content/reference` at `2177e28d` (2026-11-04), all of which `remark-mdx` parses. The labels are the ones the site's components show a reader, read from its source.

**One file is not indexed.** `learn/rsc-sandbox-test.md` is in no sidebar and its URL is a 404: it tests the site's RSC sandbox, and it is the only user of `SandpackRSC`. The other 180 are all live, checked one by one, at the URL their path gives.

| Component | Uses | What becomes of it |
|---|---|---|
| `Sandpack`, `SandpackWithHTMLOutput` | 733, 9 | Each file is a code block, labelled with its language and file name. The 251 files marked `hidden` are dropped, since a reader cannot see them or check a citation of them. |
| `Note`, `Pitfall`, `DeepDive`, `Deprecated` | 164, 95, 84, 4 | A callout: `Note`, `Pitfall`, `Deep Dive`, `Deprecated` |
| `Experimental`, `Wip`, `RSC` | 3, 1, 7 | A callout: `Experimental Feature`, `Under Construction`, `React Server Components` |
| `YouWillLearn` | 43 | A callout: `You will learn`, or `In this chapter` with `isChapter` |
| `Hint`, `Solution` | 47, 91 | A callout: `Hint`, `Solution` |
| `Solution`, empty | 63 | Dropped: inside `Recipes` it only divides the examples |
| `Recap`, `Challenges` | 31, 28 | A section. Each is an h2 on the site, with the anchor `recap` or `challenges` and the text `Recap` or `Try out some challenges`. |
| `Recipes` | 23 | A section. It is an h4 on the site, with `titleText` and `titleId`, or `Try out some examples` and `examples`. The examples inside are `####` too, and nest under it. |
| `ConsoleBlock`, `ConsoleLogLine` | 15, 5 | A callout: `Console error` or `Console warning`, by `level` |
| `TerminalBlock` | 17 | A code block, `bash`, verbatim |
| `Diagram`, `Illustration` | 39, 24 | A callout, `Diagram` or `Illustration`: the alt text, then the caption |
| `img`, markdown images | 18, 20 | The alt text. Of a light and dark pair, one. With no alt text, nothing. |
| `CanaryBadge`, `ExperimentalBadge` | 2, 2 | The words the site shows: `Canary only`, `Experimental only` |
| `Intro`, `LearnMore`, `DiagramGroup`, `IllustrationBlock`, `ConsoleBlockMulti`, `FullWidth`, `CodeDiagram`, `div` | 179, 31, 19, 6, 4, 1, 1, 8 | Layout: what they hold is kept |
| `CodeStep`, `Math`, `MathI`, `span` | 178, 18, 23, 4 | Inline styling: the words are kept |
| `s` | 1 | Dropped with its word: the site strikes it out |
| `InlineToc` | 98 | Dropped: the site builds it from the headings |
| `{/* */}`, `[comment]: <> ()`, `---` | 7, 7, 584 | Dropped |

**A component the survey did not see is an error,** with its file and line. It could be a status box, and passing its markup through would put it in the index without anyone deciding. A later sync that meets one stops there.

**Anchors.** All 2,113 headings write their id as `{/*id*/}`, and the anchor is that id, unchanged, underscores included. A heading without one is an error, which upstream's own check does not allow. `github-slugger` is not needed. No page uses an anchor twice for different headings. 116 of the headings have no text of their own, such as `## Usage` directly above its first `###`: no chunk records them, so no golden anchor can point at them, and the walk's skip for an entry with no fact covers them.

**A heading inside a box keeps its section,** since it has an anchor a citation can link to: 94 in `DeepDive`, 91 in `Challenges`, 63 in `Recipes`, 17 in `Note`, 9 in `Pitfall`. What follows the box belongs to the heading before it, as it does on the page. That takes a second section with the same heading path and anchor, 10 in all, which the chunker already tells apart by occurrence. `drl eval walk` lists such a heading once.

**A long callout is cut between its blocks,** and each part keeps the label. The chunker never splits a callout, and a `Deep Dive` or a `Solution` can hold a whole example.

**What the walk sees.** `Recap`, `Challenges` and the `Recipes` titles are no markdown headings, so the history does not show them, and they take their page's date. The walk says how many headings that is.

**What the parser leaves in the text.** A code block's label keeps the language and the file name, and drops the highlights, `active` and `{expectedErrors}`. The file name matters, since examples import each other by it. 8 code blocks nested in list items stay inside their prose, as in TypeScript's parser. Frontmatter has `title`, except 4 pages of tags that write `link: "<link>"` and so on, and `version` goes in `metadata`.

**The size,** before any embedding: 180 files, 3,141,916 bytes, 1,586 chunks, about 838K estimated tokens. The largest chunk is 2,350 tokens, a single code block. Over all 180 files the conformance suite has no failures, and outside code, titles and headings no component markup or import line is left.

**What came out of the sync,** read back from the index: 180 documents, each with chunks, and 1,586 chunks with a vector each, byte for byte the chunks of the dry run above. No component markup or import line is left, and each of the 3,360 visible code blocks is whole in one chunk. The sync took 1h 25m, 1h 22m of it waiting on rate limits, and Voyage billed 705,447 tokens in 256 requests, which is $0.0423 at list prices.

## Estimates

From M5's measured costs, with no API call: $0.0043 per answer in row 0, and $0.038 per answer with its judge in the rows that read docs.

| Item | Estimate |
|---|---|
| Row 0, 20 answers and their judge | about $0.40 |
| Row 2, 20 answers and their judge | about $0.77 |
| Row 3, 40 answers and their judge, and the judge's second opinion | about $1.84 |
| Row 4, 40 answers and their judge | about $1.53 |
| **Claude, in all** | **about $5**, with a limit of $10 |
| Voyage embeddings, about 0.8M tokens (SPEC section 8) | 80 to 100 minutes, inside the free tokens |
| Voyage rerank, 20 calls | 20 to 25 minutes, inside the free tokens |

## Alternatives considered

- **6 fresh questions, as first proposed.** Only 6 to 0 could be significant. The owner chose 10.
- **Picking fresh questions by what row 0 gets wrong.** It would make R1 true by construction.
- **A date window, or the answering model's training cutoff as the line.** A window is a number someone chooses after looking at the docs, and a cutoff picks by what the model is said to know, which is a step towards picking by row 0. A walk from the newest has no number to choose.
- **Row 5 on React.** It would cost about $0.45 of Haiku, by size, and more than an hour of embeddings, for a result M5 gives no reason to expect.
- **Copying the handlers into a second app, or one app with two configs.** The first duplicates logic and its tests. The second is not what SPEC section 4 describes, and M8's app reads two indexes anyway.
- **Moving the handlers into `core`.** It needs no new package or rule, but it puts HTTP in the engine.
