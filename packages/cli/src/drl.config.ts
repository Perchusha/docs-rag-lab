// The one place for model IDs, prices and API limits (CLAUDE.md, SPEC section
// 14). Packages may not import apps, so the CLI keeps its own config (ADR-0004).
import { defineConfig } from '@docs-rag-lab/core'
import { typescriptSource } from '@docs-rag-lab/source-typescript'

export default defineConfig({
  dataDir: 'data',
  cacheDir: '.cache',
  sources: [typescriptSource({ branch: 'v2' })],
  embeddings: {
    provider: 'voyage',
    // Voyage through MongoDB Atlas. Keys scoped to a region use eu. or us.ai.mongodb.com.
    endpoint: 'https://ai.mongodb.com/v1',
    model: 'voyage-4',
    dimensions: 1024,
    // Atlas free trial (no payment method on the org): 3 requests and 10K tokens per minute.
    // The local estimate runs high: billed/estimated was 0.84 on the full TypeScript index.
    // 3,600 estimated tokens is about 3,000 billed, so 3 requests a minute stay about 10%
    // under the token limit (3K estimated left the sync bound by requests, at ~6K TPM).
    batch: { maxInputs: 1000, maxTokens: 3_600 },
    rateLimit: { rpm: 3, tpm: 10_000 },
    // Tier 1 (payment method added): 2,000 requests and 8M tokens per minute.
    // batch: { maxInputs: 1000, maxTokens: 100_000 },
    // rateLimit: { rpm: 2_000, tpm: 8_000_000 },
  },
  models: {
    answer: 'claude-sonnet-5-5',
    contextualize: 'claude-haiku-5-5',
  },
  answer: { effort: 'low', maxTokens: 16_000 },
  // Hybrid = vector + BM25 + exact tokens, fused by RRF (ADR-0005). k=60 and 50 candidates
  // per list are the usual defaults, not tuned; M4 tunes them on the full golden set.
  retrieval: { strategy: 'hybrid', topK: 8, candidates: 50, rrfK: 60 },
  pricing: {
    checked: '2026-10-31',
    sources: [
      'https://platform.claude.com/docs/en/about-claude/pricing',
      'https://www.mongodb.com/docs/voyageai/management/billing/',
    ],
    // USD per million tokens. Haiku 5.5 prices are for prompts up to 100K tokens.
    // Voyage list price; Atlas includes 200M free tokens per model.
    models: {
      'voyage-4': { input: 0.06 },
      'claude-sonnet-5-5': {
        input: 2,
        output: 10,
        cacheWrite5m: 2.5,
        cacheRead: 0.1,
      },
      'claude-haiku-5-5': {
        input: 0.1,
        output: 0.5,
        cacheWrite5m: 0.125,
        cacheRead: 0.01,
      },
    },
  },
})
