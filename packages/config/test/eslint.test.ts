import { describe, expect, it } from 'vitest'

import { createConfig } from '../eslint.js'

function rulesOf(config: ReturnType<typeof createConfig>): string[] {
  return config.flatMap((entry) => Object.keys(entry.rules ?? {}))
}

describe('createConfig', () => {
  it('adds the React hooks rules only when asked', () => {
    expect(rulesOf(createConfig(import.meta.dirname))).not.toContain('react-hooks/rules-of-hooks')
    const react = rulesOf(createConfig(import.meta.dirname, { react: true }))
    expect(react).toContain('react-hooks/rules-of-hooks')
    expect(react).toContain('react-hooks/exhaustive-deps')
  })
})
