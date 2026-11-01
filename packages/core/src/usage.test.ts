import { describe, expect, it } from 'vitest'

import type { PricingSettings } from '@docs-rag-lab/settings'
import { formatUsage, UsageMeter } from './usage.ts'

const pricing: PricingSettings = {
  checked: '2026-10-31',
  sources: ['https://example.com/pricing'],
  models: {
    'embed-model': { input: 0.06 },
    'chat-model': { input: 2, output: 10, cacheWrite5m: 2.5, cacheRead: 0.1 },
  },
}

describe('UsageMeter', () => {
  it('estimates cost per model from list prices per million tokens', () => {
    const meter = new UsageMeter()
    meter.recordEmbedding('embed-model', 400_000)
    meter.recordEmbedding('embed-model', 100_000)
    meter.recordMessage('chat-model', {
      input_tokens: 5_000,
      output_tokens: 1_000,
      cache_creation_input_tokens: 2_000,
      cache_read_input_tokens: 10_000,
    })

    const cost = meter.estimateCost(pricing)

    expect(cost.byModel.get('embed-model')).toBeCloseTo(0.03, 10)
    // 5k x $2 + 1k x $10 + 2k x $2.50 + 10k x $0.10, per million
    expect(cost.byModel.get('chat-model')).toBeCloseTo(0.026, 10)
    expect(cost.total).toBeCloseTo(0.056, 10)
    expect(cost.unpriced).toEqual([])
    expect(meter.totalTokens()).toBe(518_000)
  })

  it('reports models without a price instead of guessing', () => {
    const meter = new UsageMeter()
    meter.recordMessage('new-model', { input_tokens: 10, output_tokens: 1 })
    expect(meter.estimateCost(pricing)).toMatchObject({ total: 0, unpriced: ['new-model'] })
  })
})

describe('formatUsage', () => {
  it('summarizes every model in one line, with cache hits and the price date', () => {
    const meter = new UsageMeter()
    meter.recordEmbedding('embed-model', 1_234)
    meter.recordEmbeddingCacheHits('embed-model', 5)
    meter.recordMessage('chat-model', { input_tokens: 5_120, output_tokens: 160 })

    expect(formatUsage(meter, pricing)).toBe(
      'usage: embed-model 1,234 tokens in 1 request, 5 cached ($0.0001) | ' +
        'chat-model 5,120 in / 160 out ($0.0118) | ' +
        'total 6,514 tokens, $0.0119 estimated at list prices checked 2026-10-31',
    )
  })

  it('says so when a command made no API calls', () => {
    expect(formatUsage(new UsageMeter(), pricing)).toBe('usage: no API calls, 0 tokens, $0.0000')
  })
})
