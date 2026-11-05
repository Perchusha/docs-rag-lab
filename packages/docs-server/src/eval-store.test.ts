import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { evalStore } from './eval-store.ts'

describe('evalStore', () => {
  it('finds the repository root and the app source, in a runtime with no import.meta.dirname', () => {
    const store = evalStore('demo')

    expect(existsSync(join(store.root, 'pnpm-workspace.yaml'))).toBe(true)
    expect(store.sourceId).toBe('demo')
    expect(store.dataDir).toBe(join(store.root, 'data'))
  })
})
