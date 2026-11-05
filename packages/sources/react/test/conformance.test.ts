import { fileURLToPath } from 'node:url'

import { listSourceFiles, runSourceConformance } from '@docs-rag-lab/source-kit'
import { describe, expect, it } from 'vitest'

import { reactSource } from '../src/index.ts'

const fixtureRoot = fileURLToPath(new URL('../__fixtures__/repo/', import.meta.url))

describe('react source', { timeout: 30_000 }, () => {
  it('passes the conformance suite over the upstream fixtures', async () => {
    const source = reactSource()
    const files = listSourceFiles(fixtureRoot, source)

    expect(files).toHaveLength(19)
    const report = await runSourceConformance(source, {
      files,
      urlPattern: /^https:\/\/react\.dev\/(learn|reference)(\/[\w-]+)*$/,
    })
    expect(report.failures).toEqual([])
  })
})
