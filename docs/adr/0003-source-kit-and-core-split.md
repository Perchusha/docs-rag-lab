# ADR-0003: What lives in source-kit and what lives in core

- Status: accepted
- Date: 2026-10-31
- Milestone: M1

## Context

SPEC section 4 splits the ingest work between two packages:
- `source-kit`: the Source interface, git sync, hashing, the embedding cache and the conformance suite;
- `core`: chunking, contextualization, embeddings, retrieval, generation and the eval runner.

M0 deferred one question (ADR-0002, rule `source-kit-only-db`): where does the embedding cache live? Writing M1 raised a second one. The conformance suite must check that a source "produces the same chunk IDs on two parses" and "produces no empty chunks" (SPEC section 7). The suite runs inside each source package, and sources may import only source-kit. With the chunker in core, the suite could not chunk anything.

## Decision

### 1. The embedding cache lives in core

- The cache key is `sha256(provider id + input type + text)`, where the provider id names the provider, the model and the dimensions (`voyage:voyage-4:1024`). The value is a vector. Both are concepts of the embedding provider interface, which core owns.
- The cache is a decorator around that interface (`embedWithCache` in core), so the cache logic and the provider sit in one package.
- The table and its typed queries live in `db` (`EmbeddingCache`, `data/cache.sqlite`). Only core uses them.
- SPEC section 7 says "sync, diffing, hashing and caching live in source-kit, not in individual sources". The point of that sentence is what a source does not do. Sources still do no caching.

Putting the cache in source-kit would have made source-kit import `db`, so every source package would load better-sqlite3 and the sqlite-vec native addon on import. Sources are pure parsers and should stay that way.

### 2. The chunker lives in source-kit

- `chunkDocument`, the chunk ID function, `text_hash` and `CHUNKER_VERSION` live in source-kit.
- The conformance suite (`runSourceConformance`) chunks every fixture twice and checks IDs, hashes, empty chunks and that code blocks survive whole.
- The suite returns a list of failures instead of asserting, so source-kit has no test-runner dependency and core can import it at runtime.

Core keeps embeddings, contextualization (M5), retrieval, generation and the ingest orchestration that ties sync, parsing, chunking and embedding together.

### 3. source-kit becomes a leaf

Rule `source-kit-only-db` becomes `source-kit-is-leaf`: source-kit imports no other internal package. The boundary fixtures now hold two violations for it (`imports-core.ts`, `imports-db.ts`), and the allowed edge `source-kit -> db` is gone from the test.

## Consequences

- The dependency graph is `sources -> source-kit`, `core -> source-kit, db`, `cli -> core, sources`. `source-kit` and `db` are both leaves.
- A new source gets the chunker and the conformance suite from one import, and its tests never load a native module.
- Contextualization in M5 has to reuse stored contexts through the source index or its own cache; it cannot assume a cache inside source-kit.
- SPEC sections 4 and 7 are updated to match.

## Alternatives considered

- **Cache in source-kit, as SPEC section 4 literally says.** Rejected for the native-addon reason above.
- **Chunker in core, conformance suite in core.** core may not import a concrete source (`core-only-source-kit-db`), so it could not run the suite over a source's fixtures. Running it from the CLI instead would split each source's tests across two packages.
- **Pass the chunker into the suite.** The source's test would have to import core to get it, which `sources-only-source-kit` forbids.
