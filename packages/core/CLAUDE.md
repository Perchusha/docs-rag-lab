# packages/core

The RAG engine: chunking, contextualization, embeddings, hybrid search, rerank, generation and the eval runner (SPEC sections 9 and 10). Empty until M1.

## Boundaries

- Imports only `@docs-rag-lab/source-kit` and `@docs-rag-lab/db` (rule `core-only-source-kit-db`).
- Never imports `ui`, a concrete source (`@docs-rag-lab/source-*`) or an app. Apps and the CLI pass sources in.
- Exposes everything through `src/index.ts`.

## Conventions

- The pipeline is hand-written: no LangChain, LlamaIndex or other RAG frameworks.
- Model IDs, prices and limits come from config, never from literals in code.
- Call Claude through `@anthropic-ai/sdk` directly, so `search_result` blocks and citations work.
- Every retrieval returns a serializable trace object (SPEC section 9).
- Unit tests use fixtures. Anything that calls Anthropic or Voyage is a `*.network.test.ts`.
