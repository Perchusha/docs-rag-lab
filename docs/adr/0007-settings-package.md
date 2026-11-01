# ADR-0007: Engine settings live in a leaf package

- Status: accepted
- Date: 2026-11-01
- Milestone: M3
- Closes the open question in ADR-0004, section 1

## Context

ADR-0004 put every model ID, price and limit in `packages/cli/src/drl.config.ts`, because packages may not import apps and so the CLI cannot read an app's `rag.config.ts`. It deferred the question to M3, "when the first app needs the same values".

The ts-docs app needs almost all of them:
- the embedding provider settings, which must match the index that `drl sync` built;
- the answer model, effort and token limit;
- the retrieval defaults;
- the prices, to report what an answer cost.

The config also held `Source` objects, which carry functions. M4 will write the settings into every eval report, so they must serialize, and they must never contain a secret.

## Decision

### 1. `@docs-rag-lab/settings` holds the values and their schema

- `src/settings.ts` is the old `drl.config.ts`, moved with its history:
  - data and cache dirs;
  - embeddings: endpoint, model, dimensions, batch and rate limits;
  - the answer and contextualization models, answer effort and max tokens;
  - retrieval: strategy, top K, candidates per list, RRF k;
  - prices, with the date and the pages they were checked against.
- `src/types.ts` holds the schema (`Settings`, `EmbeddingsSettings`, `RetrievalSettings`, `PricingSettings`, `ModelPrice`, `Effort`) and `defineSettings`. These types used to live in core's `config.ts`, which is gone, together with `DrlConfig` and `defineConfig`.
- The CLI and every app import the same object. An app's `rag.config.ts` keeps only what belongs to the app: its id, source, title, theme and example questions.

### 2. Plain data, no secrets

- No functions and no class instances. Sources are options as data, `sources: { typescript: { branch: 'v2' } }`, and the CLI builds the `Source` objects with `typescriptSource(settings.sources.typescript)`.
- API keys are not part of the settings. They are read from `process.env` only inside the provider constructors in core:
  - `createVoyageProvider` reads `VOYAGE_API_KEY` when it builds the official client;
  - `createClaudeClient()` reads `ANTHROPIC_API_KEY`;
  - `createEmbeddingProvider(settings.embeddings)` no longer takes a keys argument.
- `findRepoRoot`, `loadRootEnv` and `requireKey` moved from the CLI to core (`env.ts`), so the CLI and the apps share them. `loadRootEnv` only fills `process.env` from the dotenv file at the repository root. A missing key throws `MissingKeyError`, whose message names the key and never a value.
- `settings.test.ts` proves it:
  - the object survives a JSON round trip unchanged, and every leaf is a string, number or boolean;
  - no key is named like a secret (`key`, `secret`, `token`, `password`, `credential`), and no value looks like an API key;
  - every model the settings use has a price.

### 3. A leaf, with types-only access from core

- `settings-is-leaf`: settings imports no internal package. It cannot import contracts either, so `RetrievalSettings.strategy` repeats the `'vector' | 'hybrid'` union. A type test in core checks that it equals contracts' `Strategy`.
- `core-settings-types-only`: core imports only types from settings (dependency type `type-only`). Model IDs and prices reach core as arguments from the CLI or an app, never as an import. Core itself never picks a model.
  - Limit, found in review: dependency-cruiser counts `import { type Settings } from ...` as type-only, but with `verbatimModuleSyntax` Node keeps it as `import {} from ...` and loads the module. The shared ESLint preset therefore has `@typescript-eslint/no-import-type-side-effects`, which requires `import type` for imports of types only. A value is still never readable without a value import, which the rule does catch.
- `ui-no-internal-packages` already keeps ui out. A fixture proves it.
- The core allowlist (`core-allowed-packages`) now names settings.

Each rule has a violating fixture in `packages/config/__fixtures__/boundaries`.

## Consequences

- One copy of every model ID, price and limit. The rule "no model IDs or prices outside config" now means "outside `packages/settings`".
- A settings object can go into a trace or an eval report as it is.
- A host has to call `loadRootEnv` before it creates a provider. The CLI does it in `run()`, and the network smoke test at the top of the file.
- The CLI's `drl ask` creates the Claude client before retrieving, so a missing Anthropic key still fails before any Voyage call.
- Adding a source means adding its options to the `sources` type in settings and a factory call in each host that uses it.

## Alternatives considered

- **A full copy in each app's `rag.config.ts`**, as SPEC section 4 first sketched it. Prices and Voyage limits would exist twice and drift; only an embedding-model mismatch would be caught, by the index check at query time.
- **The app imports the CLI's config.** No new package, but one entry point would depend on another, which is what `apps-not-to-apps` exists to prevent.
- **The schema stays in core, the values move to settings.** settings would import core for the types, so it would not be a leaf, and every importer of settings would load core.
- **A copy of the schema in settings, with core keeping its own.** Two definitions of the same shapes, checked only where a host passes one into the other.
