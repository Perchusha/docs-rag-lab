---
paths:
  - "**/*.test.ts"
  - "**/*.test.tsx"
---

# Tests

- Unit tests never touch the network. Use fixtures from a `__fixtures__/` folder next to the code.
- A test that must call a real API (Anthropic, Voyage, GitHub) is named `*.network.test.ts`. The shared Vitest preset excludes those files, so they are opt-in.
- Fixtures copied from upstream docs stay byte-for-byte. Never reformat them.
- Temporary files go to the OS temp dir (`mkdtempSync(join(tmpdir(), ...))`), never to `data/` or `.cache/`.
- New behavior gets a test in the same change (CLAUDE.md, Definition of done).
- Run one package with `pnpm turbo run test --filter=<package>`. The Stop hook runs the tests of packages changed since HEAD.
