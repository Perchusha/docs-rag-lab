# ADR-0018: The interview-prep app, its question bank, and what M8 tests

- Status: accepted as the plan and the test, before any paid call, app screen or generated question exists.
- Date: 2026-11-08
- Milestone: M8

## Context

M8 is the interview-prep MVP of SPEC section 11: technology selection, compiler-verified TypeScript questions, React Pitfall questions, a text mock interview and basic progress. From M8 on a milestone has one main hypothesis, M8 is judged mainly by the owner's hands-on review, and it aims for 3 to 4 PRs (ADR-0015, section 6).

The owner's use case: pick technologies from a list, TypeScript and React, and run through interview theory, with questions and answers grounded in the docs, and code examples verified by the compiler where possible. The main way in is one click, "Quick 10".

The owner approved the plan on 2026-11-08 with four decisions: the mock interview is a fixed loop in M8 and an agent with tools waits for M9; the bank covers TypeScript's Handbook, Reference and compiler options and React's Learn and Reference, with no release notes; a checker reads every generated question; and progress uses `ts-fsrs` 5.4.2. The owner added the UX rules and the cost rule below.

## Decision

### 1. The screens

A new app, `apps/interview-prep`, on http://127.0.0.1:3002:

- **The main screen.** The technologies as checkboxes, and **Quick 10**: ten cards that are due or new, across the chosen technologies, with no topic to pick. Below it, the topic map and a practice entry per topic. On the first run nothing is due, so the screen says what Quick 10 will do instead of "Due today: 0".
- **The topic map.** Sections, such as TypeScript: Handbook or React: Learn, are collapsed by default. A search box filters topics by name. Each topic says in words how much of it was seen and how much was good, never by colour alone.
- **A card.** The question, the code it shows and an optional answer field. Revealing it shows the expected answer, the compiler's output for a compiled example, the quote it rests on and a link to the docs section, then four ratings, Again, Hard, Good and Easy.
- **The setup the site hides is one click away,** by the owner's decision after PR 1. When the visible code uses names declared in the part `---cut---` hides, "does it compile?" would otherwise have the honest answer "Cannot find name". So a card shows that part in a collapsed "Setup (hidden on the site)" disclosure: the default view matches the site, and the declarations are one click away. The bank keeps it as the code's `setup`.
- **The mock interview and its summary.** A question, the owner's answer, feedback with citations and a score of 0 to 2, a follow-up, and at the end the weak topics and three sections to read.

**The keyboard never fires while typing.** In the answer field, Ctrl+Enter reveals the answer. Space reveals it, and 1 to 4 rate, only when focus is outside the field, and the ratings only after the answer is shown. The hints are on screen, and keyboard play tests in the ui stories hold all of this.

### 2. Topics

A source says where each of its documents sits, through an optional `interviewTopic` on `Source` (source-kit), and leaves out what the bank does not cover:

- **TypeScript:** each Handbook and Reference page is a topic, and the compiler options are one topic, "Compiler options": 102 of the 137, by the rule below. Release notes and the other docs are left out.
- **React:** each Learn page is a topic. Reference pages are aggregated by their folder: Hooks (the `use*` pages of `reference/react`), the rest of `reference/react`, `react-dom`, Server Components (`rsc`), Rules of React and the hooks lint rules. React Compiler and the dev tools had topics of their own until the rule below left their reference pages out.

Core reads no source's paths: it asks the source.

**Pages about setting up tools stay out,** by the owner's rule of 2026-11-09, written after the pilot and before the full run. The pilot showed Haiku writing setup trivia from React's installation pages, such as what to install before local development, although its prompt asks it to skip setup steps. The rule:

> A page about installing, setting up or configuring a tool, rather than about the language or the library itself, stays out of the bank and the topic map.

Each source applies it, and the lists below follow from it. A page that explains the language or the library through a tool stays in, such as a lint rule that states a Rule of React.

- **TypeScript, 35 option pages,** those that change only how tsc, its build mode, its watcher or an editor runs, and not what TypeScript checks, how it resolves modules, what it emits or how a project is laid out:
  - watch mode: `watchFile`, `watchDirectory`, `fallbackPolling`, `synchronousWatchDirectory`, `excludeDirectories`, `excludeFiles`, `preserveWatchOutput`, `assumeChangesOnlyAffectDirectDependencies`;
  - build mode, and the cache of incremental builds: `clean`, `force`, `verbose`, `stopBuildOnErrors`, `incremental`, `tsBuildInfoFile`;
  - editors and type acquisition, project references in an editor among them: `disableReferencedProjectLoad`, `disableSolutionSearching`, `disableSourceOfProjectReferenceRedirect`, `plugins`, `disableSizeLimit`, `typeAcquisition` with its `include` and `exclude`, `enable`, `disableFilenameBasedTypeAcquisition`;
  - the compiler's own diagnostics and console output: `diagnostics`, `extendedDiagnostics`, `explainFiles`, `listFiles`, `listEmittedFiles`, `traceResolution`, `generateCpuProfile`, `generateTrace`, `pretty`, `noErrorTruncation`, `locale`.

  No Handbook or Reference page is about a tool. The project setup pages the owner named, such as Integrating with Build Tools, Compiler Options in MSBuild and Configuring Watch, are among the other docs, which the bank never covered, and Nightly Builds is not indexed at all.
- **React, 23 pages:** the 7 Learn pages on starting a project and on editors and developer tools (`installation`, `creating-a-react-app`, `build-a-react-app-from-scratch`, `add-react-to-an-existing-project`, `setup`, `editor-setup`, `react-developer-tools`), React Compiler's installation, incremental adoption and debugging pages and its 10 reference pages on configuration and directives, the 2 developer tools reference pages, and the lint plugin's page on installing it. React Compiler's introduction, on what it does, and the lint rules stay.

**The refinement of 2026-11-09, by the owner, after the full run and before any label:** the options on how a project is laid out are about TypeScript as it is used in a project, and come up in interviews, senior ones above all. So `files`, `include`, `exclude`, `extends`, `composite` and `references` are back in the bank and the topic map, which first left them out with 41 option pages. The three options on project references in an editor stay out with the editor's, and `incremental` and `tsBuildInfoFile`, the cache of incremental builds, with build mode. Their questions were written then, and H's sample was drawn again by the same procedure from the final bank, since nothing had been labelled.

H's sample is drawn only from the pages that remain: questions already written for a page the rule leaves out are dropped from the bank by the next run, so they are neither shown nor sampled.

### 3. The bank is a committed file, not a table in the index

SPEC section 6 planned a `questions` table in each source's index. A new table changes the index schema, which every report's identity names, so no report before M8 would verify (ADR-0010, ADR-0017). The bank is instead `interview/bank/<source>.jsonl`, committed, as the contexts of M5 are:

- **A header** names the source, the index it was built from, the docs commit and the generator and checker, each as its model and the hash of its prompt.
- **One row per question**, with its status: shown, dropped by the quote check, or dropped by the checker with its reason. One row per chunk that was sent to the generator, so a chunk that gave no question is not sent again.
- **A rerun pays only for chunks whose text changed,** by their text hash, and a question whose chunk changed is stale and not shown.
- **The file holds no em dash.** Generated text and quotes have them replaced by a hyphen, as the contexts did, and the quote check compares texts with the same replacement.

TypeScript's bank reads the compiled index, since its compiler questions need the compiler's output. React's reads the plain index.

### 4. Compiler questions are verified by the compiler

From each compiled example, with no call to any model:

- **Which error:** an example with errors asks whether it compiles and, if not, which errors and on which lines. The answer is the compiler's list.
- **Which type:** each `^?` query asks what type TypeScript shows for its target on that line. The answer is the compiler's text.

The code is shown as the docs site shows it: a source's optional `displayCode` takes out the twoslash directives that would give the answer away, such as `// @errors: 2345` and the `^?` lines, and keeps only what `---cut---` leaves visible. An example whose error line is not visible after that gives no question. The pairing of a chunk's compiler output with its code is read back from the chunk text by source-kit, which renders both (ADR-0017). These questions need no eval: a unit test holds that each answer is the compiler's output as stored.

### 5. Generated questions, and the checks they pass

- **Haiku writes them,** one call per chunk: up to two theory questions where the chunk holds something an interviewer would ask, and one question for each React Pitfall callout in it. Each question comes with its answer and a quote from the chunk that supports it.
- **Code is never written by the model.** A question that shows code names one of the chunk's code blocks by number, and the app shows that block from the docs, through `displayCode`.
- **The quote check is code.** A quote not found in its chunk's text, ignoring whitespace, markdown emphasis and the dash replacement, drops the question.
- **Sonnet then checks every question that is left,** one call per chunk: whether it can be answered from that chunk alone, and whether the stored answer is right and complete for what it asks. A question that fails is dropped, with the reason kept.

**Prompt caching, and the meter.** Generation sends the whole document with each of its chunks, as the contexts did in M5, under a cache entry: the first request for a document finishes before the others start. The check needs only its chunk, so it caches its instructions and not the document: a document prefix it does not need would cost more than the chunk alone, since a cache write is priced above an uncached read. The meter already counts cache writes and reads apart from uncached input, and the estimate does too.

### 6. Progress

FSRS through `ts-fsrs` 6.0.0, with no fuzz, so that the same ratings always give the same days. PR 2 shipped 5.4.2, and the owner had it changed on 2026-11-09, before the bank's paid run: 5.4.2 patches `Date.prototype` on import, which changes `Date` for the whole server process. 6.0.0 patches nothing, schedules with FSRS-7, and adds one dependency, `@open-spaced-repetition/srs-kit`, by the same authors (BSD-3-Clause). A card 5.4.2 stored starts over, and keeps its count of ratings. Progress, ratings and sessions live in `data/apps/interview-prep.sqlite`, generated and never committed, through a module in `db`. A card is due by FSRS. A new card is one never rated.

### 7. The mock interview is a fixed loop

The interviewer asks a theory question from the bank for the chosen technologies. The owner answers. Hybrid search on the plain index retrieves passages for the question and the answer, and Sonnet grades the answer against them, with citations, a score of 0 to 2 and one follow-up. After the last question, the summary names the weak topics and three sections to read. An agent with tools, `search_docs`, `get_progress` and `record_score`, is M9's agentic mode, which can take this loop over.

### 8. Packages

- **`contracts`:** the bank's questions, topics, ratings and progress, and the interview's events.
- **`core`:** the bank, the topics, FSRS and the interviewer.
- **`interview-server`,** new: the app's route handlers, under the same boundary as `docs-server`. It imports `core`, `contracts` and `settings`, never `ui`, `db` or a source.
- **`ui`:** the technology picker, the topic map, the card, the ratings, the progress summary and the interview, each with stories in both colour schemes, with axe and keyboard play tests.
- **`cli`:** `drl questions <source>`, and the sheet and score of the test below.

### 9. Not in M8

Levels, a pasted job description, voice, promoting a question to the golden set and an agent with tools.

## The hypothesis

**H: the generated questions are grounded.** A question the app shows can be answered from the passage it cites, and its stored answer is right and complete for what it asks.

**The test.** After the full run, a blind sample of 20 shown generated questions:
- **10 from each source,** and at least 3 of React's on Pitfall callouts;
- **from a fixed seed,** in shuffled order, showing for each the question, any code, the stored answer, the quote and the whole cited chunk, and nothing of the checker;
- **labelled by the owner** on two counts: answerable from the cited passage, yes or no, and the answer right and complete, yes or no.

**H holds if at most 2 of the 20 fail on either count,** with its Wilson interval beside it. This is a set-level criterion (ADR-0014): no single question decides it. The labels are committed before they are compared with anything.

**Reported, and deciding nothing:** how many questions the quote check and the checker dropped, per source and per kind.

**A miss** hides the generated questions in the app, the compiler questions stay, and the owner is asked. If the prompts then change, a fresh sample of 20 that the first did not show decides, under the same rule.

**Not tested:** the compiler questions, whose answers are the compiler's, and the mock interview's grading, which only the owner's hands-on review covers.

## What stops the work

The work stops, and the owner is asked, if:
- **the forecast for M8 passes $10** of Claude;
- **H misses;**
- **a paid run would start without the pilot's output shown to the owner.**

## Estimates

At the list prices in `packages/settings`, from about 2,060 chunks in scope and about 1.07M tokens of their documents:
- **generation, Haiku:** about $0.75, of which about $0.25 is the documents' cache writes and reads;
- **the check, Sonnet:** about $6;
- **the mock interview:** about 2 to 3 cents a turn, as it is used.

About $7 for the bank, against a limit of $10 for M8. A pilot replaces these guesses with measured tokens before the full run, as in M5.

## What the bank's run gave

Written on 2026-11-09, after the run and before the owner labels H's sample.

**The pilot,** 10 chunks of each source, shown to the owner before the full run: 35 questions, 29 shown, $0.09, and a forecast of about $7.30 for the rest. It led to the rule on tool setup pages above.

**The full run** wrote the bank's questions for every chunk in scope:

| Source | Chunks | Compiler questions | Generated | Shown | Dropped by the quote check | Dropped by Sonnet |
|---|---|---|---|---|---|---|
| TypeScript | 436 | 327 | 913 | 790 | 43 | 80 |
| React | 1,527 | 0 | 2,877 | 1,863, of which 63 on Pitfall callouts | 413 | 601 |

- **React's quote check drops more,** 14% against 5%: its chunks are often code, challenges and their solutions, and Haiku quoted another part of the document, which it reads whole. Those questions are not grounded in the chunk they cite, so dropping them is the check working.
- **A checker reply that skipped a verdict stopped the first start,** on one TypeScript chunk. Verdicts are now read in order when they are numbered otherwise, and a question with no verdict is not kept, with a reason saying so. Committing that fix stopped the React start by the run guard (ADR-0010), and the rerun paid only for what was missing.

**Spend: $8.89 of Claude at list prices,** against the limit of $10: the pilot $0.09, the two stopped starts $0.46, and the run $8.34. The forecast of $7.30 was low by about a fifth: Haiku wrote about two questions per chunk, and Sonnet's reasons were longer than the pilot's.

**H's sample is drawn,** sample `892b4a468224`: 10 questions of each source, 3 of React's on Pitfall callouts, all from the pages the rule keeps, with nothing of the checker on the sheet.

## The PRs

1. This ADR, the bank's code and `drl questions`, with no paid call. The compiler questions are written then, since they cost nothing.
2. The practice app: `interview-server`, the progress store, the ui components and `apps/interview-prep`.
3. The bank's paid run, after its pilot, and the test of H.
4. The mock interview, then the README, the journal and SPEC, and the milestone's close.

## Alternatives considered

- **A `questions` table in each source's index,** as SPEC section 6 had it. Every report before M8 would stop verifying.
- **An agent with tools as the interviewer in M8.** It is M9's subject, and a fixed loop is enough to practise with.
- **Opus as the checker.** About three times Sonnet's price on every question, for a check that reads one chunk.
- **No checker,** with only the quote check. It would save about $6, and H would then test generation alone. The owner chose to keep it, as SPEC section 11 has it.
- **The document as a cached prefix for the check too.** A document of n chunks would be written once and read n - 1 times, which costs more than sending each chunk alone, and the check does not need the rest of the document.
- **`ts-fsrs` 5.4.2,** chosen first, since it has no dependency. It patches `Date.prototype` on import, which was found after the choice, so 6.0.0 replaced it (section 6).
