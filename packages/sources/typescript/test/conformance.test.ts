import { fileURLToPath } from 'node:url'

import { listSourceFiles, runSourceConformance } from '@docs-rag-lab/source-kit'
import { describe, expect, it } from 'vitest'

import { typescriptSource } from '../src/index.ts'

const fixtureRoot = fileURLToPath(new URL('../__fixtures__/repo/', import.meta.url))

// It parses and chunks every fixture document several times: 3.7s on a CI
// runner alone, 6.3s while the ui story tests and next build share the CPUs.
describe('typescript source', { timeout: 30_000 }, () => {
  it('passes the conformance suite over the upstream fixtures', async () => {
    const source = typescriptSource()
    const files = listSourceFiles(fixtureRoot, source)

    expect(files).toHaveLength(8)
    const report = await runSourceConformance(source, {
      files,
      urlPattern:
        /^https:\/\/www\.typescriptlang\.org\/(docs\/handbook\/[\w/-]+\.html|tsconfig\/(\w+\.html|#type-\w+))$/,
    })
    expect(report.failures).toEqual([])
  })
})
