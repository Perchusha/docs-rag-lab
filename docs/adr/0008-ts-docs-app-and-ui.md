# ADR-0008: The ts-docs app and the ui stack

- Status: accepted
- Date: 2026-11-01
- Milestone: M3
- Updated: 2026-11-02, the UX pass before M4 (section 9)
- Amends ADR-0001 (the app has a build task; versions of the deferred dependencies)

## Context

M3 (SPEC section 13) adds the first app: a streaming chat with citations, the retrieval inspector, and Storybook for `ui`. Its acceptance: the inspector shows candidates, scores and chunk boundaries.

The first half of M3 prepared the engine: `contracts` for the shapes ui renders (ADR-0006), `settings` for the values every host shares (ADR-0007), and `createEngine` with `ask()` reporting events. This ADR covers the second half: the Next.js app, the ui package, how both are tested, and the four conditions set when M3 was approved:
- bind the app to localhost;
- render the model's markdown safely;
- make the inspector accessible, with no state shown by colour alone;
- check sorting and tab navigation by keyboard in the tests.

## Decision

### 1. A spike came first

Before any engine change, a throwaway Next.js 16.4.3 app in a separate worktree ran core's `retrieve()` over a copy of the real index, in `next dev` and in `next build && next start`. Findings:
- Opening the index takes 3-7 ms per request and retrieval 5-8 ms, so the engine opens the index per call.
- `sqlite-vec` finds its native library with `import.meta.resolve`. Bundled, it fails at runtime with `tR.resolve is not a function`, so it must be a server external package. better-sqlite3 is on Next's default list. Under pnpm the app needs neither as a direct dependency.
- Workspace packages need no `transpilePackages`: pnpm links them to real paths outside `node_modules`, and Turbopack compiles them like app code, `'use client'` and CSS Modules included.
- An NDJSON response from a route reaches the client chunk by chunk, and a client disconnect fires the request's abort signal. That is why `ask()` takes an `AbortSignal`: the one change the spike made to the engine API.
- `next dev` writes an `AGENTS.md` into the app, with an em dash in it. `agentRules: false` turns that off.
- `next-env.d.ts` points at `.next/dev/types` in dev and `.next/types` after a build, so it is gitignored.

### 2. The app is thin

`apps/ts-docs` holds config, a page and three routes:
- **`rag.config.ts`** holds only what belongs to the app: ID, source, title, tagline, theme, example questions, the input's placeholder and plain names for the doc types, checked by `defineDocsApp` from ui. Engine values come from settings (ADR-0007). The page passes `settings.retrieval.strategy` and core's `DOC_TYPES` to the client component.
- **Routes** are one line each. They call handlers in `src/server/handlers.ts`, which take a `Request` and return a `Response`, so they are tested without Next.js:
  - `POST /api/ask` streams `AnswerEvent`s as NDJSON (ADR-0006). The response waits for the first event, so a request the engine refuses still gets a status code: 400 for a bad field or an unknown source, 503 when there is no index yet, 500 for a missing key. After the first event, a failure is sent as an `error` event and logged on the server. `ask()` gets the request's signal combined with one that fires when the response body is cancelled, so closing the tab stops the Claude stream even if one of the two never fires, and no error event is sent once the browser has gone.
  - `POST /api/search` returns the trace. It makes no Claude call, which makes "Search only" and the inspector's Hybrid/Vector toggle free apart from an uncached query embedding.
  - `GET /api/documents?source=&path=` returns a document's chunks in order, for the inspector's chunk boundaries.
- **Request bodies** go through `parseRetrievalRequest` from contracts first: shape only, unknown fields refused, questions capped at 2,000 characters. The engine then checks the values (ADR-0006).
- **One engine per server process**, built on the first request, for the source `rag.config.ts` names. The rate limiter must see every request, or Voyage's 3 requests per minute would not hold across them. The root dotenv file is loaded there with core's `loadRootEnv`, because Next.js only reads the app folder's own.
- **`next.config.ts`:** `serverExternalPackages: ['better-sqlite3', 'sqlite-vec']`, `turbopack.root` and `outputFileTracingRoot` at the repository root, `agentRules: false`, and `devIndicators: false`, because Next's indicator covers the page's bottom-left corner.
- **Scripts:**
  - `typecheck` is `next typegen && tsc --noEmit`, so route types exist before tsc runs;
  - `build` is `next build`. CI runs it, because bundling problems only show there. This is the repository's only build task: packages still ship their TypeScript source (ADR-0001);
  - the root `pnpm dev` and `pnpm storybook` call pnpm directly, not turbo. Turbo's strict env mode would hide API keys set in the shell from the task, and only the dotenv file would work.
- **dependency-cruiser** skips `next-env.d.ts`, which holds only type references that do not resolve as modules.

### 3. The app listens on 127.0.0.1 only

`dev` and `start` pass `--hostname 127.0.0.1`. By default Next.js listens on every interface. The routes have no authentication, and `/api/ask` spends Claude credits, so anyone on the same network could spend them. `netstat` shows `127.0.0.1:3000` only, and the "Network:" line Next prints is the loopback address too. Storybook also binds to `127.0.0.1`.

Serving the app anywhere else needs authentication first. That is out of scope: SPEC section 2 says everything runs locally.

### 4. The answer's markdown is rendered safely

Claude answers in markdown, rendered with react-markdown:
- **No raw HTML.** There is no `rehype-raw`, so HTML in an answer shows as text.
- **React-markdown's default URL sanitizing stays,** so `javascript:` and other unsafe URLs are dropped.
- **Only http(s) links render as links.** They open in a new tab with `rel="noopener noreferrer"`, and say so to screen readers. Other links render as their text, so a relative URL cannot point into the app.
- **Images render as their alt text,** so an answer cannot load anything from another site.
- **Citation markers** become links to `#cite-<n>` in the markdown, placed right after the text they cite (before trailing whitespace, so a marker never starts a paragraph). A marker in or right after a code block goes on the last line of text before that block, past any rule or heading underline: inside the block it would be code, on the closing fence line it would keep the block open, and on a line of its own it reads as a lone number. With no text before the block it does take its own line, after the block or, if the block is still open, before it. Fences are read as CommonMark reads them (`scanFences`): only the same character, at least as long, with nothing after it closes a block, and a block can sit in a list or a quote. The renderer turns them into buttons named after their source.

- **GFM adds tables, and no way around these rules.** Claude often answers with a table, so `remark-gfm` is on. Task lists render as text, so an answer adds no form controls. Only two tildes strike through, because `singleTilde` would catch version ranges like `~5.0`. Autolinks follow the http(s) rule.
- **Tables and code blocks scroll in their own box** (`ScrollRegion`), so the page does not: a focusable group with a name, the table's taken from its column headers. The arrow keys scroll it, and axe's scrollable-region rule accepts it. It is a group rather than a region, so several in one answer do not each add a landmark.

Two details came from a real recorded answer with a table:
- A marker placed after a row's last pipe would be an extra cell, which GFM drops without a trace, and the citation with it. It goes inside the last cell; a marker after a delimiter row goes in the header row.
- Comparison tables leave the corner header empty, which axe flags (`empty-table-header`). An empty header renders as a plain cell.

`AnswerMarkdown.test.tsx` checks each point on server-rendered HTML.

### 5. ui

- **One public component.** The app renders `DocsAssistant` from a server component with serializable props: endpoints, not a fetch function. Stories and tests pass a `transport` that replays recorded data instead. The other components are its parts and stay private.
- **A chat of independent questions.** No conversation history is sent to Claude, so after the first question the input says "Ask a new question". Earlier questions stay on the page, each with its sources and its trace. A new question stops one still running, which stays as it was, marked "Stopped".
- **State** is a pure reducer over `AnswerEvent`s for each exchange, and a second one over the list of exchanges, both unit tested. The first also says what the status region announces.
- **Styling:** CSS Modules. `tokens.css` holds colours, spacing, radii and fonts as custom properties, light and dark through `prefers-color-scheme`. The app's accent comes from `rag.config.ts` as a light and a dark shade, because one colour cannot reach 4.5:1 on both backgrounds. TypeScript blue `#3178c6` reaches only 4.4:1 on white, so the app uses `#235a97` in light mode and `#79b8ff` in dark mode.
- **The fusion view** turns the trace into rows, with pure, tested functions: each list's rank, score and `1 / (k + rank)` contribution, the Δ against the vector rank, and which chunks BM25 counts twice. Contribution bars are drawn against the highest possible score, first place in every list, so bars compare across questions.

### 6. Accessibility

The conditions from the M3 approval, and how each is met:
- **Double counting is not shown by colour alone.** The two BM25 lists share one hue in two shades, and every row in both lists also says "BM25 x2". A banner names the tokens that are both a search term and an exact token, and says how many context chunks are in both BM25 lists.
- **The fusion view is a real `<table>`** with a caption and column headers. Sortable headers are buttons inside `<th>` elements that carry `aria-sort`, on the sorted column only.
- **The inspector tabs follow the WAI-ARIA tabs pattern:** one tab stop, the arrow keys move between tabs and wrap, Home and End go to the first and last, and a tab is selected when it gets focus. Every panel exists in the DOM, hidden, so each `aria-controls` points at an element.
- **The streaming answer is not a live region.** A screen reader would read every delta. A polite status region announces the state instead: "Searching the docs", "Writing the answer", "Answer ready, with 1 source", "Stopped", and errors.
- **Animation respects `prefers-reduced-motion`.** `tokens.css` stops every animation and transition under it; the only animation is the progress dots.
- **Reflow at 320 CSS px** (WCAG 1.4.10: 1280 px at 400% zoom). The chat and the inspector stack below 64rem, and nothing scrolls sideways but a table's or code block's box. The tab list wraps. Links and cards break long URLs and anchors. A scroll box is `position: relative`, or the absolutely positioned hidden text in a wide table escapes it and widens the page. Sentences stay outside the boxes, so reading one never needs sideways scrolling. The fusion table uses the same focusable box, because its right-hand columns hold nothing focusable and a keyboard could not otherwise reach them.

Also:
- each focusable element shows a 2px focus outline (`:focus-visible`);
- Send and Stop are one button that changes role, so it keeps focus when a run starts or ends, and no button is ever disabled;
- opening the inspector moves focus into it, and closing it returns focus to what opened it, or to the input if that has gone;
- the input sticks to the bottom of the page, except in windows under 30rem tall. It grows with its text, so a `ResizeObserver` sets the page's `scroll-padding` to its real height, and it never hides a focused element (WCAG 2.4.11);
- the selected chunk is marked with `aria-current` and a visible "selected" label, not only a background. Selecting is not a toggle, so there is no `aria-pressed`;
- a citation button moves focus to its chunk in the Context tab, once: `useInspectorPanel` clears the request when it is done, so coming back to the tab later leaves focus in the tab list;
- each rank cell reads "1, score 9.16", not "19.16", through visually hidden text.

### 7. Every story is a test

`packages/ui/vitest.config.ts` has two projects:
- **unit**: pure logic in Node: the answer markdown, the reducer, the fusion rows, the stream reader, the transport, and markdown safety.
- **stories**: `@storybook/addon-vitest` runs every story in headless Chromium through Playwright:
  - the story must render, and its play function must pass;
  - axe runs on it with `a11y.test: 'error'`, so any violation fails the test;
  - the project runs twice, with Playwright's `colorScheme` set to light and to dark, so axe's colour-contrast rule checks both sets of tokens in a real browser, which jsdom cannot do. A "Foundations/Tokens" story puts every text colour on each background it is used on.

Play functions cover the conditions in section 6:
- sorting with Enter and Space on the header buttons, and `aria-sort` moving with it;
- the tabs with the arrow keys, Home and End, and the single tab stop;
- a citation moving focus to its chunk, and the tab list keeping focus afterwards;
- a new question stopping one still streaming, which stays in the chat as it was, with nothing more reaching it;
- the inspector opening on demand, with focus going in and coming back;
- the toggle calling `search` and never `ask`, with a spy, and a search beside a streaming answer leaving that answer alone;
- a search result arriving late, after a newer search, a citation or a new question, and changing nothing;
- nothing spent by accident: Enter on a doc type or during composition, and a double click on Send;
- ten lines in the input, and a Tab walk through a long answer with no stop hidden behind it (`InputNeverCoversFocus`);
- the status texts, and Stop;
- reflow at a real 320 by 256 viewport (`Reflow320`): in the empty state, with the panel closed, and on each tab with it open, it walks every element and fails on anything past the page edge, or any sideways scroller but a table's or code block's box. It also checks that a table and a code block really overflow there, so axe's scrollable-region rule has something to check.

**A test controls when a replay moves on.** A story that checks anything but the final state uses a `ReplayGate`, never a timer: each step of the replay waits until the test releases it, so a state lasts as long as the test needs, however slow the machine is. An earlier version checked a state its replay held for 15 ms, and moving that check to a 400 ms delay only made the race rarer. The replay can also keep going after its abort (`ignoresAbort`), as a real response does with what it has read, and each search method can have its own gate. That is the only way to test that a late result reaches nothing: a replay that rejects on abort, or finishes in order, passes without the check. Such a story has no state to wait for, so it gives the result 50 ms to land; on a slow machine that can only miss a bug, not fail a correct build. A story that waits only for a final state may use a delay, which is there to watch it stream in Storybook. Its limit, 10s for `findBy*` and `waitFor`, is a bound on failure, not something a passing test waits for.

Stories replay recorded fixtures with no network:
- three real traces from `drl search --json` (`satisfies`, TS2345, ts-0004) and a vector-only trace;
- four recorded answer streams: the `satisfies` answer ($0.0171), one with a table with cited cells and two code blocks ($0.0238), and two with long and fenced excerpts for the sources ($0.0234, $0.0248);
- one derived answer stream, the only fixture that is not verbatim, and its file name says so: a real answer about `--strict` ($0.0185) with its first citation event moved to right after its code block. That shape depends on how Claude splits citation blocks. It happened in a live run, but five recording attempts did not reproduce it;
- one document's chunks.

Every excerpt of the docs in them is cut to 300 characters (NOTICE: short excerpts).

Three things were needed to make this stable:
- **`optimizeDeps.include: ['react-markdown', 'remark-gfm']`.** Vite found them mid-run, reloaded the page, and every running test failed. This happens on every run with an empty cache, as in CI.
- **`api: { port: 5199 }`.** Vitest's default browser port, 63315, falls in a range Windows hands to Hyper-V, which changes at each boot. There it fails with `EACCES`, and Vitest only tries another port when one is taken.
- **`.storybook/preview.css`** gives the canvas the app's page colours. Without it, the dark stories drew light text on Storybook's white canvas, and axe rightly failed them.

CI installs Playwright's headless Chromium, cached per Playwright version, and its system libraries from apt. Locally, run `pnpm --filter @docs-rag-lab/ui exec playwright install --only-shell chromium` once.

### 8. Dependencies

Checked on npm on 2026-11-01. Every version was more than a day old.

| Package | Version | Where | Why |
|---|---|---|---|
| next | 16.4.3 | ts-docs | The app (deferred to M3 by ADR-0001) |
| react, react-dom | 19.3.1 | catalog: ts-docs; ui as a peer | |
| @types/react, @types/react-dom | 19.3.0 | catalog (dev) | |
| react-markdown | 10.1.0 | ui | Claude answers in markdown. Built on unified and remark, which the parsers already use |
| remark-gfm | 4.0.1 | ui | Tables in answers. Already used by the TypeScript parser, at the same version |
| storybook, @storybook/react-vite, @storybook/addon-a11y, @storybook/addon-vitest | 10.6.5 | ui (dev) | Storybook (SPEC section 5), axe on every story, stories as tests |
| @vitest/browser-playwright, playwright | 5.0.5, 1.64.1 | ui (dev) | Run the story tests in Chromium |
| eslint-plugin-react-hooks | 7.1.1 | config | The rules of hooks and the React Compiler rules, through `createConfig(dir, { react: true })` |
| @next/eslint-plugin-next | 16.4.3 | ts-docs (dev) | Next's lint rules; Next 16 has no `next lint` |

pnpm 12 fails an install when a dependency has a build script that `allowBuilds` does not list. Storybook brings esbuild, whose script only checks its platform binary, which the optional `@esbuild/<platform>` package already provides. It is listed as `esbuild: false`.

### 9. The UX pass before M4

Trying the app showed that it read like an admin panel. It serves someone asking a question and someone exploring how retrieval works, and it showed both everything at once. The default view now serves the first, and the inspector opens on demand for the second.

**The default view:**
- A centered column, 760px at most, with one input and its button inside it. Enter sends and Shift+Enter adds a line; Enter that confirms a word in an input method does neither.
- The examples show only before the first question, and send at once.
- The question becomes the user's message, as an `<h2>`, so a screen reader can jump between questions. A new question goes to the top of the page, with room for its answer above the input.
- "Search in: All docs" replaces the fieldset of checkboxes: a disclosure button over native checkboxes, with names from `rag.config.ts`. Esc or a click elsewhere closes it. A multi-select listbox would have more keys to learn and nothing to gain.
- Tokens and cost move into the inspector with the other jargon. The status region stays, and its text is hidden visually once nothing is running. An error shows in the answer itself.

**The inspector:**
- `InspectorPanel` opens from "How was this found?" under each finished answer, or from a citation, which opens it on that chunk. From 64rem up it sits beside the chat with its own scroll; under that it stacks below the chat.
- It is a top-level `<aside>`, beside `main`, because a complementary landmark must not nest in another one.
- An open panel moves on to a new question and starts clean. What opened it belongs to an earlier answer then, so closing it goes to the input.

**Its controls make no Claude call:**
- The Hybrid/Vector toggle (native radios) re-runs the search field's text, so comparing methods is one free click. It also sets the method for the next question.
- The search field starts with the question and can be edited, with "Search only" next to it. Both use the doc types chosen next to the chat's input.
- `useFreshSearch` has its own abort, so a search never touches a streaming answer, and a newer one replaces an older one.
- A line that is also the panel's status region says what the trace below is: the answer's, or "Showing a fresh vector search, with no Claude call. The answer came from hybrid search." A citation drops a fresh search, because it points into the answer's own trace.
- **A consequence we accepted:** the inspector opens only from an answer, so a fresh page cannot reach Search only until one answer has been paid for, about $0.02.

**The bugs:**
- **One numbering, the citation's.** Rows for a cited chunk carry a "Source N" badge in all four tabs, and the button says "Show in the inspector". The context rank stays as plain text in the Context tab, where it means something else. The Document tab says "in the context", with no number.
- **Parts.** Sections that split gave their chunks identical labels, and so did two sections with one heading path, which are numbered together. `CHUNKER_VERSION` 4 records `part` (ADR-0004), `TRACE_VERSION` 3 carries it, and `chunkLabel` in contracts is the one wording, for the title sent to Claude, the CLI and ui. Titles are not searched, so rankings cannot change, and 20 of 20 M2 searches came back identical.
- **Excerpts render as markdown,** with the same renderer as the answer. Their headings render as bold text, so they do not join the page's outline. `excerptPreview` keeps up to 5 lines of text and 260 characters. It closes a code block it cuts through with the opener's indent, leaves out an empty code box, and cuts a long line at a word, backing up to before a link or emphasis it would leave open. Over the index's 8,115 rendered blocks, no preview shows a raw bracket or bold, an empty code box or an open fence.

**What a citation needs goes through context,** not into react-markdown's component map. A new map remounted the whole answer on every new callback or citation, which took focus off a citation. The map is now constant.

**Parsing is memoized on the text.** Earlier answers stay on the page, and the page renders on every delta of the newest one. Without this, a stream event cost 50 ms at the sixteenth question in a dev build, with 27 long tasks. It now costs 7.8 ms, with none.

## Consequences

- One code path serves the CLI and the app. The routes add only parsing, status codes and the stream.
- The ui test task takes about 18s with Chromium, and it needs the browser installed once. The Stop hook runs it whenever ui changes.
- The ui's post-edit check is the slowest in the repository: 8.4-8.5s on a forced cache miss, just over the 8s budget of ADR-0002. Its own runs during this PR had a median of 4.5s. See ADR-0002.
- A new docs app (react-docs in M6) is a `rag.config.ts`, a page and three one-line routes.
- Every new ui state needs a story. axe then checks it in both colour schemes with no further work.

## Alternatives considered

- **Tailwind CSS.** Rejected when M3 was planned. Because ui is a separate package, each app would have to scan ui's sources, which couples apps to ui internals.
- **jsdom and Testing Library for component tests.** Faster to start, but jsdom computes no layout or colour. axe's contrast rule cannot run there, and the dark scheme cannot be emulated.
- **Storybook's separate test-runner.** It needs a running Storybook. `addon-vitest` runs the stories inside the existing Vitest setup and turbo's `test` task.
- **An `aria-live` answer.** A screen reader would read every streamed delta. The status region says when the state changes instead.
- **Binding to all interfaces with a shared token.** That adds secrets to manage for an app that only ever runs on the developer's machine.
- **A modal inspector.** Comparing the trace with the answer is the point, so the answer has to stay in reach. The panel traps nothing, and only Esc inside it closes it.
- **An entry point for Search only in the empty state.** It would be free, but it would put retrieval back in front of someone who came to ask a question.
- **`transpilePackages` for the workspace packages.** The spike showed Turbopack compiles them without it, so it would be config with no effect.
