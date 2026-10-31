# packages/sources

One package per documentation source, named `@docs-rag-lab/source-<id>`. A source only knows how to parse its own format into a `ParsedDoc` (SPEC section 7).

## Boundaries

- Import only `@docs-rag-lab/source-kit` (rule `sources-only-source-kit`): no core, no db, no ui, no other source.
- Sync, diffing, hashing and caching live in source-kit, never here.

## Conventions

- Every source passes `runSourceConformance(source, fixtures)` from source-kit.
- Fixtures in `__fixtures__/` are byte-for-byte copies of upstream files. Never reformat them; Prettier and the em-dash check skip them.
- `ParsedDoc.url` is the absolute canonical public URL used in citations.
- Code blocks are preserved byte-for-byte and never split.
- Golden eval questions live in `eval/questions.jsonl`, and a human approves every one.
- New sources are scaffolded with `turbo gen source` (from M6), not by copying a folder.
