import { describe, expect, it } from 'vitest'

import { settings } from './settings.ts'

/** Every [path, value] pair in a JSON-like value, depth first. */
function leaves(value: unknown, path = ''): [string, unknown][] {
  if (typeof value !== 'object' || value === null) return [[path, value]]
  return Object.entries(value).flatMap(([key, child]) => leaves(child, `${path}.${key}`))
}

describe('settings', () => {
  it('is plain data that survives a JSON round trip unchanged', () => {
    expect(JSON.parse(JSON.stringify(settings))).toEqual(settings)
    for (const [path, value] of leaves(settings)) {
      expect(['string', 'number', 'boolean'], path).toContain(typeof value)
    }
  })

  it('holds no secrets: no key is named like one and no value looks like an API key', () => {
    for (const [path] of leaves(settings)) {
      expect(path).not.toMatch(/key|secret|token(?!s)|password|credential/i)
    }
    for (const [path, value] of leaves(settings)) {
      if (typeof value !== 'string') continue
      // Anthropic keys start with sk-ant-, Voyage keys with pa-.
      expect(value, path).not.toMatch(/^(sk-|pa-)|[A-Za-z0-9_-]{32,}/)
    }
  })

  it('has a price for every model it uses', () => {
    const used = [settings.embeddings.model, settings.models.answer, settings.models.contextualize]
    for (const model of used) expect(Object.keys(settings.pricing.models)).toContain(model)
  })

  it('keeps retrieval within the limits the CLI accepts', () => {
    const { topK, candidates, rrfK } = settings.retrieval
    expect(topK).toBeGreaterThan(0)
    expect(topK).toBeLessThanOrEqual(100)
    expect(candidates).toBeGreaterThanOrEqual(topK)
    expect(rrfK).toBeGreaterThan(0)
  })
})
