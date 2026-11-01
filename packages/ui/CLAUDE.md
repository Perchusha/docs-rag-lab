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
- Stories replay recorded data through `replayTransport`, never the network. Fixtures in `src/__fixtures__/` are real traces and answers, with every docs excerpt cut to 300 characters (NOTICE). Read them through `src/fixtures.ts`.
- The answer's markdown: no raw HTML (no rehype-raw), keep react-markdown's URL sanitizing, http(s) links only, opening in a new tab with `rel="noopener noreferrer"`, images as alt text.
- Accessibility: state is never shown by colour alone; tables are real tables; tabs follow the WAI-ARIA tabs pattern; the streaming answer is not a live region, the polite status region announces state changes; animations stop under `prefers-reduced-motion`.
- Story tests need Chromium once per machine: `pnpm --filter @docs-rag-lab/ui exec playwright install --only-shell chromium`.
- No model IDs, prices or API keys in this package. Model names shown in the usage line come from the data.
- Citations link to the canonical doc URLs carried in the data, never to guessed URLs.
- No em dashes in UI copy; use plain hyphens.
