# packages/sources

One package per documentation source, named `@docs-rag-lab/source-<id>`. A source only knows how to parse its own format into a `ParsedDoc` (SPEC section 7).

## Boundaries

- Import only `@docs-rag-lab/source-kit` (rule `sources-only-source-kit`): no core, no db, no ui, no other source.
- Sync, diffing, hashing and chunking live in source-kit, and the embedding cache in core (ADR-0003), never here.

## Conventions

- Every source passes `runSourceConformance(source, fixtures)` from source-kit.
- Bump the source's `parserVersion` whenever `parse` gives different output for the same file. The next sync then re-parses everything by itself, and unchanged chunk text is not re-embedded (ADR-0005). Without the bump, stale chunks stay in the index until someone runs `--full`.
- `exactTokens` (optional) maps tokens in a question to how the docs write them, for keyword search: TypeScript turns `TS2345` into `2345`.
- Fixtures in `__fixtures__/` are byte-for-byte copies of upstream files. Never reformat them; Prettier and the em-dash check skip them.
- `ParsedDoc.url` is the absolute canonical public URL used in citations.
- Code blocks are preserved byte-for-byte and never split.
- Golden eval questions live in `eval/questions.jsonl`. TypeScript's were each approved by a human. For React, Claude drafts a smaller set and a human reviews the flagged ones (ADR-0015). Drafts live in `eval/questions.draft.jsonl` until that review, with `eval/questions.review.md` for what it covers and `eval/fresh-walk.md` for how the fresh questions were picked. The `write-eval-questions` skill has the steps. The format is in SPEC section 10.
- `eval/questions.lock.json` records what the anchors resolve to, and `drl eval check --accept` writes it. A test fails when it does not cover exactly the anchors of the file.
- `eval/targets.json` holds ranks that reports check, such as the M2 targets in SPEC section 13. It is not part of the golden set.
- A reviewed golden set is frozen: a change needs a reason from the docs text, never a ranking, plus a new version and a changelog entry (ADR-0009, section 9).
- New sources are scaffolded with `turbo gen source` (`tooling/generators`), not by copying a folder, and the `/add-source` skill goes on from there.
