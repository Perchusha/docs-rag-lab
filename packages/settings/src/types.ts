// The schema of the engine settings (ADR-0007). Settings are plain data: no
// functions, no class instances and no secrets, so they can be written into
// traces and eval reports as they are. API keys never appear here; the
// provider constructors in core read them from the environment.

/** USD per million tokens. */
export interface ModelPrice {
  input: number
  output?: number
  /** Cache writes are priced at the 5-minute rate; nothing uses 1-hour caching yet. */
  cacheWrite5m?: number
  cacheRead?: number
}

export interface PricingSettings {
  /** When the prices were last checked, and where. */
  checked: string
  sources: string[]
  models: Record<string, ModelPrice>
}

export interface VoyageEmbeddingsSettings {
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

export type EmbeddingsSettings = VoyageEmbeddingsSettings

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export interface RetrievalSettings {
  /** The same values as Strategy in @docs-rag-lab/contracts; core checks that they match. */
  strategy: 'vector' | 'hybrid'
  /** Chunks that go to generation. */
  topK: number
  /** Depth of each candidate list (vector, keyword, exact) before fusion. */
  candidates: number
  /** The k of Reciprocal Rank Fusion. */
  rrfK: number
}

/** Options for a source's factory, as data. The CLI and apps build the Source objects. */
export interface SourceSettings {
  branch: string
}

export interface Settings {
  /** Generated data, relative to the repository root (gitignored). */
  dataDir: string
  /** Source checkouts, relative to the repository root (gitignored). */
  cacheDir: string
  /** Options per source, keyed by source ID. Hosts build the Source objects (the CLI in sourcesFor). */
  sources: { typescript: SourceSettings }
  embeddings: EmbeddingsSettings
  models: {
    answer: string
    contextualize: string
  }
  answer: { effort: Effort; maxTokens: number }
  retrieval: RetrievalSettings
  pricing: PricingSettings
}

export function defineSettings(settings: Settings): Settings {
  return settings
}
