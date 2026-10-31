// Opt-in network smoke test: `pnpm test:network`. One tiny Voyage embedding
// and one tiny Haiku call with a search_result block, to check both keys and
// the endpoints. Costs well under $0.001. Excluded from `turbo test` and CI.
import {
  createClaudeClient,
  createEmbeddingProvider,
  formatUsage,
  UsageMeter,
} from '@docs-rag-lab/core'
import { afterAll, describe, expect, it } from 'vitest'

import config from './drl.config.ts'
import { findRepoRoot, loadEnv, requireKey } from './env.ts'

loadEnv(findRepoRoot(import.meta.dirname))
const meter = new UsageMeter()

afterAll(() => {
  console.log(formatUsage(meter, config.pricing))
})

describe('network smoke test', () => {
  it('embeds one word with Voyage through the configured endpoint', async () => {
    const provider = createEmbeddingProvider(config.embeddings, {
      voyage: requireKey('VOYAGE_API_KEY'),
    })

    const result = await provider.embed(['hello'], 'query')
    meter.recordEmbedding(provider.model, result.tokens)

    expect(result.vectors).toHaveLength(1)
    expect(result.vectors[0]).toHaveLength(config.embeddings.dimensions)
    expect(result.tokens).toBeGreaterThan(0)
  })

  it('answers a tiny question with Haiku from one search result', async () => {
    const client = createClaudeClient(requireKey('ANTHROPIC_API_KEY'))
    const model = config.models.contextualize

    const message = await client.messages.create({
      model,
      max_tokens: 64,
      thinking: { type: 'disabled' },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'search_result',
              source: 'https://example.com/sky',
              title: 'Sky',
              content: [{ type: 'text', text: 'On a clear day the sky is blue.' }],
              citations: { enabled: true },
            },
            { type: 'text', text: 'What color is the sky on a clear day? Answer in five words.' },
          ],
        },
      ],
    })
    meter.recordMessage(model, message.usage)

    const textBlocks = message.content.filter((block) => block.type === 'text')
    const text = textBlocks
      .map((block) => block.text)
      .join('')
      .trim()
    const citations = textBlocks.flatMap((block) => block.citations ?? []).length
    console.log(
      `${model}: "${text}" (${String(citations)} citation(s), stop: ${String(message.stop_reason)})`,
    )
    expect(text).not.toBe('')
  })
})
