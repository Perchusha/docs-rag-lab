// The shape of the drl config. The values (model IDs, prices, limits) live in
// one config file only, never in code (CLAUDE.md, SPEC section 14).
import type { Source } from '@docs-rag-lab/source-kit'

/** USD per million tokens. */
export interface ModelPrice {
  input: number
  output?: number
  cacheWrite5m?: number
  cacheWrite1h?: number
  cacheRead?: number
}

export interface PricingConfig {
  /** When the prices were last checked, and where. */
  checked: string
  sources: string[]
  models: Record<string, ModelPrice>
}

export interface VoyageEmbeddingsConfig {
  provider: 'voyage'
  /** The Voyage API through MongoDB Atlas, for example https://ai.mongodb.com/v1. */
  endpoint: string
  model: string
  dimensions: number
  /** Per request: inputs, and estimated tokens (ADR-0004). */
  batch: { maxInputs: number; maxTokens: number }
  /** Requests and billed tokens per minute. */
  rateLimit: { rpm: number; tpm: number }
}

export type EmbeddingsConfig = VoyageEmbeddingsConfig

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export interface DrlConfig {
  /** Generated data, relative to the repository root (gitignored). */
  dataDir: string
  /** Source checkouts, relative to the repository root (gitignored). */
  cacheDir: string
  sources: Source[]
  embeddings: EmbeddingsConfig
  models: {
    answer: string
    contextualize: string
  }
  answer: { effort: Effort; maxTokens: number }
  retrieval: { topK: number }
  pricing: PricingConfig
}

export function defineConfig(config: DrlConfig): DrlConfig {
  return config
}
