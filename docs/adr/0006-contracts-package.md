# ADR-0006: Shared data shapes live in a contracts package

- Status: accepted
- Date: 2026-11-01
- Milestone: M3

## Context

ADR-0002 left an open question: core produces the trace and citation shapes that ui renders, but ui may not import core, not even types (rule `ui-no-internal-packages`). ADR-0005 put the retrieval trace in core "for now" and gave the decision to M3, where the inspector is the first ui that renders it.

M3 adds more shapes that cross a boundary:
- the answer stream, which a route handler in the app writes and a hook in ui reads;
- citations, which the answer shows and the inspector links to chunks;
- a document's chunks, for the chunk-boundary view.

The trace also has more readers coming: eval stores it in M4, and the dashboard reads it back.

## Decision

### 1. A package for data that crosses boundaries

`@docs-rag-lab/contracts` holds plain data types and the few constants that go with them. Core produces them, the CLI prints them, ui renders them, apps pass them over HTTP, and eval stores them.

M3 moves the trace here unchanged:
- `RetrievalTrace` and its parts, `Strategy`, `STRATEGIES`, `ListName` and `TRACE_VERSION`;
- `ExactToken`, which the trace's query section uses;
- `TraceFusedCandidate`, a non-generic copy of RRF's fused entry. `fuseRrf` in core stays generic, and its result is assignable to the trace.

`filters.docTypes` is now `string[]` instead of source-kit's `DocType[]`, because contracts may not import source-kit. The JSON is identical, so `TRACE_VERSION` stays 1.

Core no longer re-exports these types. Every consumer imports them from contracts, so each type has one import path.

### 2. Rules that keep it safe for ui

- `contracts-is-leaf`: contracts imports no internal package. ui can import it without reaching core or db through it, which is the laundering `config-is-leaf` prevents for presets.
- `contracts-client-safe`: contracts imports nothing but its own files. That means no Node.js built-ins and no npm packages, so the same file runs in the browser, in Node with type stripping, and inside Next.js.
- `ui-no-internal-packages` now allows contracts and nothing else.
- The core rule, renamed `core-allowed-packages`, allows source-kit, db and contracts.

Each new rule has a violating fixture in `packages/config/__fixtures__/boundaries`.

### 3. A dependency-cruiser fix found on the way

`contracts-client-safe` needs to see npm imports. It saw none: the `exclude` option also matched `node_modules` and `dist/`, which removed every npm package from the graph, not only from traversal. That also meant `no-non-package-json` could never fire.
- Only fixture and generated folders are excluded now. `doNotFollow` still stops at `node_modules`.
- The real graph now holds 20 npm modules, with no new violations.
- A new fixture imports a package that its `package.json` does not declare, and the test expects `no-non-package-json` to report it.

## Consequences

- One definition of each shape. A field the inspector reads cannot drift from what core writes, because both compile against the same type.
- ui's boundary is still strict: its only internal import is a package that, by rule, contains nothing but data shapes and pure code.
- contracts can never use a library, even a small one. Validation of request bodies has to be written by hand.
- Moving a type into contracts is an API change for core's consumers: the CLI's imports changed in the same commit.

## Alternatives considered

- **ui defines its own view types**, and the app maps core's types onto them. Fields the app never maps would drift without an error, and the stream parser would exist twice, once on each end.
- **Allow `import type` from core in ui.** The import is erased at runtime, but ui would compile against core's whole API, and nothing would stop the next import from being a value. ADR-0002 read "client-safe" strictly for this reason.
- **Schemas with runtime validation (zod or JSON Schema).** They would add a dependency to a package that must run everywhere. The app is local and talks only to itself, so compile-time types are enough; request bodies get small hand-written validators.
