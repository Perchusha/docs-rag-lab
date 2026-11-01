# packages/ui

Client components: chat, citations, inspector, eval dashboard and topic map, with Storybook (from M3). Empty until M3.

## Boundaries

- Client-safe: imports no internal package but `@docs-rag-lab/contracts`, not even `import type` from core or db (rule `ui-no-internal-packages`, ADR-0006).
- No Node.js built-ins (rule `ui-no-node-builtins`).
- Data arrives through props and app route handlers. The shapes it renders (the retrieval trace, citations, the answer stream) come from `@docs-rag-lab/contracts`; ui does not define its own copies (ADR-0006).

## Conventions

- No model IDs, prices or API keys in this package.
- Citations link to the canonical doc URLs carried in the data, never to guessed URLs.
- No em dashes in UI copy; use plain hyphens.
