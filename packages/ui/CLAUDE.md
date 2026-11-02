# packages/ui

Client components for the docs assistants: chat, citations and the retrieval inspector (M3), later the eval dashboard and topic map. Decisions are in ADR-0008.

## Boundaries

- Client-safe: imports no internal package but `@docs-rag-lab/contracts`, not even `import type` from core or db (rule `ui-no-internal-packages`, ADR-0006).
- No Node.js built-ins (rule `ui-no-node-builtins`).
- Data arrives through props and app route handlers. The shapes it renders (the retrieval trace, citations, the answer stream) come from `@docs-rag-lab/contracts`; ui does not define its own copies (ADR-0006).
- The public entry exports `DocsAssistant`, `defineDocsApp` and the transport. Other components are its parts and stay private.

## Conventions

- Styles are CSS Modules that read the custom properties in `src/tokens.css`. Never hard-code a colour, size or font; add a token, and add any new text colour to the "Foundations/Tokens" story so axe checks its contrast.
- Logic that can be pure is pure and unit tested in `src/lib/` (the reducer, fusion rows, the answer markdown). Components stay thin.
- Every component state gets a story. Story tests run each story in headless Chromium, in light and dark, and fail on any axe violation. Interactions get a play function, keyboard first.
- A story that checks anything but the final state holds the replay with a `ReplayGate` and releases it step by step, never a timer. A state then lasts as long as the test needs, however slow the machine is.
- A test that something must not happen needs a replay that lets it happen: `ignoresAbort` and a gate per search method let a late result really arrive. Change the code and watch the story fail before you trust it.
- Stories replay recorded data through `replayTransport`, never the network. Fixtures in `src/__fixtures__/` are real traces and answers, with every docs excerpt cut to 300 characters (NOTICE). Read them through `src/fixtures.ts`.
- The answer's markdown: GFM for tables, no raw HTML (no rehype-raw), keep react-markdown's URL sanitizing, http(s) links only, opening in a new tab with `rel="noopener noreferrer"`, images as alt text, task lists as text.
- Anything a react-markdown component needs goes through context, never into the component map. A new map remounts the whole answer, and a focused citation with it.
- To override the global focus style, name `:focus-visible` in the selector. CSS comes in a different order in Storybook and in the app, so a tie on specificity can pass every story and still lose in the app.
- Reflow: at 320 CSS px nothing scrolls sideways but a table or code block, in a `ScrollRegion` (focusable and named). `Reflow320` checks it; a new view goes on that story's tab walk.
- Accessibility: state is never shown by colour alone; tables are real tables; tabs follow the WAI-ARIA tabs pattern; the streaming answer is not a live region, the polite status region announces state changes; a panel that opens on demand moves focus in, and returns it to what opened it, or to the input if that has gone; animations stop under `prefers-reduced-motion`.
- Story tests need Chromium once per machine: `pnpm --filter @docs-rag-lab/ui exec playwright install --only-shell chromium`.
- No model IDs, prices or API keys in this package. Model names shown in the usage line come from the data.
- Citations link to the canonical doc URLs carried in the data, never to guessed URLs.
- No em dashes in UI copy; use plain hyphens.
