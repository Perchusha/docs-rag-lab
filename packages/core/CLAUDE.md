# packages/core

The RAG engine: ingest orchestration, embeddings and the embedding cache, contextualization, hybrid search, rerank, generation and the eval runner (SPEC sections 9 and 10). The chunker lives in source-kit (ADR-0003). M2 has ingest, hybrid search (vector, BM25 and exact tokens, fused by RRF) with the retrieval trace, and cited answers.

## Boundaries

- Imports only `@docs-rag-lab/source-kit`, `@docs-rag-lab/db`, `@docs-rag-lab/contracts`, and types from `@docs-rag-lab/settings` (rules `core-allowed-packages`, `core-settings-types-only`).
- Never imports `ui`, a concrete source (`@docs-rag-lab/source-*`) or an app. Apps and the CLI pass sources in.
- Exposes everything through `src/index.ts`.

## Conventions

- The pipeline is hand-written: no LangChain, LlamaIndex or other RAG frameworks.
- Model IDs, prices and limits arrive as arguments from the CLI or an app, which read them from `@docs-rag-lab/settings`. Never a literal in code, and never an imported value (ADR-0007).
- API keys are read from `process.env` only inside the provider constructors (`createVoyageProvider`, `createClaudeClient`), with `requireKey`. Never pass a key through settings or options.
- Call Claude through `@anthropic-ai/sdk` directly, so `search_result` blocks and citations work.
- Every retrieval returns a serializable trace object (SPEC section 9, ADR-0005). Its type lives in `@docs-rag-lab/contracts` (ADR-0006); bump `TRACE_VERSION` there when its shape changes.
- Embeddings go through the `EmbeddingProvider` interface and `embedWithCache`, never a provider client directly (ADR-0004).
- Every API call records its token usage in the caller's `UsageMeter`, so commands can report tokens and cost.
- Unit tests use fixtures. Anything that calls Anthropic or Voyage is a `*.network.test.ts`.
