import { fileURLToPath } from 'node:url'

import { listSourceFiles, runSourceConformance } from '@docs-rag-lab/source-kit'
import { describe, expect, it } from 'vitest'

import { typescriptSource } from '../src/index.ts'

const fixtureRoot = fileURLToPath(new URL('../__fixtures__/repo/', import.meta.url))

describe('typescript source', () => {
  it('passes the conformance suite over the upstream fixtures', async () => {
    const source = typescriptSource()
    const files = listSourceFiles(fixtureRoot, source)

    expect(files).toHaveLength(7)
    const report = await runSourceConformance(source, {
      files,
      urlPattern:
        /^https:\/\/www\.typescriptlang\.org\/(docs\/handbook\/[\w/-]+\.html|tsconfig\/(\w+\.html|#type-\w+))$/,
    })
    expect(report.failures).toEqual([])
  })
})
