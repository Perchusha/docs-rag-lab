import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { evalStore } from './eval-store.ts'

describe('evalStore', () => {
  it('finds the repository root and this app source, in a runtime with no import.meta.dirname', () => {
    const store = evalStore()

    expect(existsSync(join(store.root, 'pnpm-workspace.yaml'))).toBe(true)
    expect(store.sourceId).toBe('typescript')
    expect(store.dataDir).toBe(join(store.root, 'data'))
  })
})
