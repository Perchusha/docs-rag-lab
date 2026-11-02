# apps

Thin Next.js App Router apps. An app is config, theme and example questions; logic lives in packages (ADR-0008).

## Boundaries

- Apps import packages through their public `index.ts`. Packages never import apps.
- An app never imports another app (rule `apps-not-to-apps`).
- Apps are where server packages (core, db, sources) meet client code (ui): server packages are used only in route handlers and server components.

## Conventions

- One config file per app: `rag.config.ts`, checked with `defineDocsApp` from ui (SPEC section 4). It holds only what belongs to the app: id, source, title, tagline, theme and example questions. Engine settings (model IDs, prices, limits, retrieval defaults) come from `@docs-rag-lab/settings` (ADR-0007), never from the app or its components.
- The theme accent is a light and a dark shade, each at least 4.5:1 on its background.
- Routes are one line each: they call the handlers in `src/server/handlers.ts`, which take a `Request` and return a `Response` and are unit tested with a fake engine. New route behavior goes in a handler, with a test.
- One engine per server process (`src/server/engine.ts`), built on the first request: the rate limiter must see every request. It loads the root dotenv file; Next.js only reads the app folder's.
- `dev` and `start` bind to `127.0.0.1`. The routes have no authentication and `/api/ask` spends Claude credits, so never listen on other interfaces (ADR-0008).
- `next.config.ts` keeps `sqlite-vec` in `serverExternalPackages` (it fails bundled) and `agentRules: false` (otherwise `next dev` writes an `AGENTS.md` with an em dash).
- `typecheck` runs `next typegen` before tsc. `next-env.d.ts` is generated and gitignored.
- Secrets come from `.env` at the repo root and are read on the server only.
- Source indexes are opened from `data/sources/<source-id>.sqlite`; app state lives in `data/apps/<app>.sqlite`.
