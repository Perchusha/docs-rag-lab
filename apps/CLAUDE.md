# apps

Thin Next.js App Router apps (from M3). An app is config, theme and example questions; logic lives in packages.

## Boundaries

- Apps import packages through their public `index.ts`. Packages never import apps.
- An app never imports another app (rule `apps-not-to-apps`).
- Apps are where server packages (core, db, sources) meet client code (ui): server packages are used only in route handlers and server components.

## Conventions

- One config file per app: `rag.config.ts` (SPEC section 4). Model IDs live there, not in components.
- Secrets come from `.env` at the repo root and are read on the server only.
- Source indexes are opened from `data/sources/<source-id>.sqlite`; app state lives in `data/apps/<app>.sqlite`.
