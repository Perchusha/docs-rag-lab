import { describe, expect, it } from 'vitest'

import config from '../next.config.ts'

describe('next.config', () => {
  it('turns off the dev indicator, which covers the page', () => {
    expect(config.devIndicators).toBe(false)
  })

  it('keeps sqlite-vec out of the bundle, and no AGENTS.md in the app', () => {
    expect(config.serverExternalPackages).toContain('sqlite-vec')
    expect(config.agentRules).toBe(false)
  })
})
