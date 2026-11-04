---
name: add-source
description: Add a documentation source end to end, from the scaffold to measured numbers in the README.
argument-hint: <source id>
disable-model-invocation: true
---

# Add the source `$0`

If no source id was given, ask for one and stop.

These are the six steps of SPEC section 12. They take several PRs, and the owner merges each one before the next starts.

## Before the first step

1. Read `packages/sources/CLAUDE.md`, SPEC sections 7, 8 and 10, "The process from M6 on" in SPEC section 13, and ADR-0015.
2. Find the ADR that fixes this source's test: its rows, its golden set, its hypotheses and what stops the work. React's is ADR-0016. **If there is none, stop.** Write it, and wait for the owner to approve it. No paid run comes before it, because a result must not shape what counts as success.
3. Send a plan: the PRs, the files each one touches, and each new dependency with its reason and its current version on npm. Wait for approval, as `CLAUDE.md` asks of any change to more than one package.

## Rules for every step

- **The session:** put this session's ID, `${CLAUDE_SESSION_ID}`, in the body of every PR this skill opens. M6's acceptance asks for it. A local session has no link, and the transcript is not committed.
- **Other sources do not change.** After each PR that touches shared code, run the integrity checks in the source's ADR. The parser of another source and the chunker stay as they are.
- **Nothing looks at retrieval until the set is frozen.** On this source, run no `drl search`, no `drl ask`, no `drl eval` other than `drl eval walk` and `drl eval check`, and do not open its inspector. If an app or a smoke test needs a question, use one that will not go in the set.
- **A command that spends prints its estimate first.** Run it without `--yes`, read the estimate, compare it with the limit in the ADR, and only then go on.
- **The stops in the ADR are stops.** Report what is known, and wait. Never change a prompt, a model, a threshold or a question to get past one.

## 1. Scaffold

Take the values from the source's part of SPEC section 8, and add that part if it is missing.

```
pnpm turbo gen source --args $0 <repo URL> <branch> <site URL> <dir:docType,dir:docType> "<license>" <license URL> "<attribution>"
pnpm install
pnpm format
```

This writes `packages/sources/$0`, with a parser that refuses every file and a conformance test that fails with `no fixtures`. That failure is the target of the next two steps. Do not copy another source's folder.

## 2. The parser, against fixtures

1. **Survey the format first,** across every file the source will index, from a shallow read-only clone in the scratchpad: each component or directive and how often it appears, the frontmatter fields, how headings get their anchors, and whether pages state dates of their own.
2. **Record what becomes of each component** in the source's ADR, and what anchors the headings have. If pages state dates, the ADR's walk may need to say so before it runs.
3. **Copy the fixtures** byte for byte to `__fixtures__/repo/`, under their upstream paths: at least one per doc type, and the pages with the hardest components. Fill in the commit and date in `__fixtures__/SOURCE.txt`.
4. **Write the parser** to give sections, blocks with code byte for byte, the canonical URL and the doc type. `packages/sources/typescript/src/markdown.ts` is the model to read. A source imports only `source-kit`, so never import another source.
5. **Test each decision** in `src/index.test.ts`: each component, heading anchors, URLs and doc types.

## 3. Conformance, registration and the index

1. Tighten `test/conformance.test.ts`: the exact number of fixture files, and a `urlPattern` that matches this site's real pages and nothing else. It passes, with no failures allowed for.
2. Register the source:
   - `packages/settings/src/settings.ts`: its options under `sources`;
   - `packages/cli/src/run.ts`, `sourcesFor`, and `packages/cli/package.json`;
   - `NOTICE`: repository, site, license and attribution;
   - SPEC section 8: the measured paths, files, bytes and estimated tokens.
3. Index it with `pnpm drl sync $0`, in the background. Voyage's free trial takes about an hour for 0.5M tokens. The commit it indexes is the pin, so record it.
4. Read what came out before going on. There is a chunk for every document, no component markup or import line is left in the text, and code blocks are whole.

## 4. The golden set

Use the `write-eval-questions` skill. It ends with the owner reviewing the flagged questions and the set frozen by `pnpm drl eval check --source $0 --accept`. That commit comes before any row answers, and it has to be an ancestor of the commit a report stamps.

## 5. Eval

Run what the ADR lists, in its order, and nothing more:

1. `pnpm drl eval check --source $0`, which has to pass.
2. `pnpm drl eval --source $0` for retrieval. Compare it with the ADR's stop on retrieval before any answer.
3. A pilot with `pnpm drl eval answers --source $0 --only <ids>`, then the estimate of the whole run.
4. The named runs, with the ADR's rows and `--noise`. A named run needs a clean tree, and it stops if HEAD or the branch moves, so make no commit while it runs. Use `--name`, then `--yes` after reading the estimate.
5. The spot check: `pnpm drl eval label <report> --spot` writes the sheet, the owner labels it blind, the labels are committed at once under `eval/labels/$0/`, and `pnpm drl eval spot-check <report> <labels>` says what it found.
6. `pnpm drl eval verify <report> --record`, and the rest of the ADR's integrity checks. If one fails, the numbers are not read as a result.
7. The hypotheses, by the verdicts `pnpm drl eval compare` gives and by the ADR's rules. Every number keeps its interval and its verdict.

## 6. The README, and closing

1. Add the measured rows to the README, saying what the set is: who drafted it, who reviewed what, and any weighting (ADR-0015). Numbers of different sources are never compared.
2. Add the entry to `docs/journal.md`, update SPEC, and update the milestone line in `CLAUDE.md`.
3. Run the `code-reviewer` subagent before committing a milestone.

An app for the source is separate work, with no generator (ADR-0016).
