import { describe, expect, it } from 'vitest'

import config from '../../rag.config.ts'
import { appSource } from './engine.ts'

describe('appSource', () => {
  it('builds the source rag.config.ts names', () => {
    expect(appSource(config.source).id).toBe(config.source)
  })

  it('refuses a source the app cannot build', () => {
    expect(() => appSource('react')).toThrow(
      'rag.config.ts names the source "react", which this app cannot build (known: typescript)',
    )
  })
})
