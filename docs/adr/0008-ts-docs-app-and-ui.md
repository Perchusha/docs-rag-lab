# ADR-0008: The ts-docs app and the ui stack

- Status: accepted
- Date: 2026-11-01
- Milestone: M3
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
- **`rag.config.ts`** holds only what belongs to the app: ID, source, title, tagline, theme and example questions, checked by `defineDocsApp` from ui. Engine values come from settings (ADR-0007). The page passes `settings.retrieval.strategy` and core's `DOC_TYPES` to the client component.
- **Routes** are one line each. They call handlers in `src/server/handlers.ts`, which take a `Request` and return a `Response`, so they are tested without Next.js:
  - `POST /api/ask` streams `AnswerEvent`s as NDJSON (ADR-0006). The response waits for the first event, so a request the engine refuses still gets a status code: 400 for a bad field or an unknown source, 503 when there is no index yet, 500 for a missing key. After the first event, a failure is sent as an `error` event. The request's signal goes to `ask()`, so closing the tab stops the Claude stream, and no error event is sent once the browser has gone.
  - `POST /api/search` returns the trace. It makes no Claude call, which makes "Search only" free apart from an uncached query embedding.
  - `GET /api/documents?source=&path=` returns a document's chunks in order, for the inspector's chunk boundaries.
- **Request bodies** go through `parseRetrievalRequest` from contracts first: shape only, unknown fields refused, questions capped at 2,000 characters. The engine then checks the values (ADR-0006).
- **One engine per server process**, built on the first request. The rate limiter must see every request, or Voyage's 3 requests per minute would not hold across them. The root dotenv file is loaded there with core's `loadRootEnv`, because Next.js only reads the app folder's own.
- **`next.config.ts`:** `serverExternalPackages: ['better-sqlite3', 'sqlite-vec']`, `turbopack.root` and `outputFileTracingRoot` at the repository root, and `agentRules: false`.
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
- **Citation markers** become links to `#cite-<n>` in the markdown, placed right after the text they cite (before trailing whitespace, so a marker never starts a paragraph). The renderer turns them into buttons named after their source.

`AnswerMarkdown.test.tsx` checks each point on server-rendered HTML. There is no `remark-gfm`, so a table in an answer shows as text. Add it if answers need tables.

### 5. ui

- **One public component.** The app renders `DocsAssistant` from a server component with serializable props: endpoints, not a fetch function. Stories and tests pass a `transport` that replays recorded data instead. The other components are its parts and stay private.
- **One question at a time.** Each question is independent: no conversation history is sent to Claude, and the inspector shows one trace. A new question replaces the last.
- **State** is a pure reducer over `AnswerEvent`s, unit tested, which also says what the status region announces.
- **Styling:** CSS Modules. `tokens.css` holds colours, spacing, radii and fonts as custom properties, light and dark through `prefers-color-scheme`. The app's accent comes from `rag.config.ts` as a light and a dark shade, because one colour cannot reach 4.5:1 on both backgrounds. TypeScript blue `#3178c6` reaches only 4.4:1 on white, so the app uses `#235a97` in light mode and `#79b8ff` in dark mode.
- **The fusion view** turns the trace into rows, with pure, tested functions: each list's rank, score and `1 / (k + rank)` contribution, the Δ against the vector rank, and which chunks BM25 counts twice. Contribution bars are drawn against the highest possible score, first place in every list, so bars compare across questions.

### 6. Accessibility

The conditions from the M3 approval, and how each is met:
- **Double counting is not shown by colour alone.** The two BM25 lists share one hue in two shades, and every row in both lists also says "BM25 x2". A banner names the tokens that are both a search term and an exact token, and how many context chunks they affect.
- **The fusion view is a real `<table>`** with a caption and column headers. Sortable headers are buttons inside `<th>` elements that carry `aria-sort`, on the sorted column only.
- **The inspector tabs follow the WAI-ARIA tabs pattern:** one tab stop, the arrow keys move between tabs and wrap, Home and End go to the first and last, and a tab is selected when it gets focus. Every panel exists in the DOM, hidden, so each `aria-controls` points at an element.
- **The streaming answer is not a live region.** A screen reader would read every delta. A polite status region announces the state instead: "Searching the docs", "Writing the answer", "Answer ready, with 1 source", "Stopped", and errors.
- **Animation respects `prefers-reduced-motion`.** `tokens.css` stops every animation and transition under it; the only animation is the progress dots.

Also:
- each focusable element shows a 2px focus outline (`:focus-visible`);
- the Stop button is `aria-disabled`, not `disabled`, so it keeps focus when a run ends;
- a citation button moves focus to its chunk in the Context tab;
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
- a citation moving focus to its chunk;
- the status texts, and Stop.

Stories replay recorded fixtures with no network:
- three real traces from `drl search --json` (`satisfies`, TS2345, ts-0004) and a vector-only trace;
- one recorded answer stream ($0.0171);
- one document's chunks.

Every excerpt of the docs in them is cut to 300 characters (NOTICE: short excerpts).

Two things were needed to make this stable:
- **`optimizeDeps.include: ['react-markdown']`.** Vite found it mid-run, reloaded the page, and every running test failed. This happens on every run with an empty cache, as in CI.
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
| storybook, @storybook/react-vite, @storybook/addon-a11y, @storybook/addon-vitest | 10.6.5 | ui (dev) | Storybook (SPEC section 5), axe on every story, stories as tests |
| @vitest/browser-playwright, playwright | 5.0.5, 1.64.1 | ui (dev) | Run the story tests in Chromium |
| eslint-plugin-react-hooks | 7.1.1 | config | The rules of hooks and the React Compiler rules, through `createConfig(dir, { react: true })` |
| @next/eslint-plugin-next | 16.4.3 | ts-docs (dev) | Next's lint rules; Next 16 has no `next lint` |

pnpm 12 fails an install when a dependency has a build script that `allowBuilds` does not list. Storybook brings esbuild, whose script only checks its platform binary, which the optional `@esbuild/<platform>` package already provides. It is listed as `esbuild: false`.

## Consequences

- One code path serves the CLI and the app. The routes add only parsing, status codes and the stream.
- The ui test task takes about 11s with Chromium, and it needs the browser installed once. The Stop hook runs it whenever ui changes.
- The ui's post-edit check is the slowest in the repository: 8.4-8.5s on a forced cache miss, at the 8s budget of ADR-0002. Its own runs during this PR had a median of 4.5s. See ADR-0002.
- A new docs app (react-docs in M6) is a `rag.config.ts`, a page and three one-line routes.
- Every new ui state needs a story. axe then checks it in both colour schemes with no further work.

## Alternatives considered

- **Tailwind CSS.** Rejected when M3 was planned. Because ui is a separate package, each app would have to scan ui's sources, which couples apps to ui internals.
- **jsdom and Testing Library for component tests.** Faster to start, but jsdom computes no layout or colour. axe's contrast rule cannot run there, and the dark scheme cannot be emulated.
- **Storybook's separate test-runner.** It needs a running Storybook. `addon-vitest` runs the stories inside the existing Vitest setup and turbo's `test` task.
- **An `aria-live` answer.** A screen reader would read every streamed delta. The status region says when the state changes instead.
- **Binding to all interfaces with a shared token.** That adds secrets to manage for an app that only ever runs on the developer's machine.
- **`transpilePackages` for the workspace packages.** The spike showed Turbopack compiles them without it, so it would be config with no effect.
