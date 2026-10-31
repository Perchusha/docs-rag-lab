# packages/ui

Client components: chat, citations, inspector, eval dashboard and topic map, with Storybook (from M3). Empty until M3.

## Boundaries

- Client-safe: imports no internal package at all, not even `import type` from core or db (rule `ui-no-internal-packages`).
- No Node.js built-ins (rule `ui-no-node-builtins`).
- Data arrives through props and app route handlers. Where shared types such as the retrieval trace live is still open (ADR-0002); until an ADR settles it, ui defines the view types it renders.

## Conventions

- No model IDs, prices or API keys in this package.
- Citations link to the canonical doc URLs carried in the data, never to guessed URLs.
- No em dashes in UI copy; use plain hyphens.
