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

export interface VoyageRerankSettings {
  provider: 'voyage'
  /** The Voyage API through MongoDB Atlas, the same as embeddings. */
  endpoint: string
  model: string
  /** How many of the fused candidates are scored, in one call per question (ADR-0014). */
  depth: number
  /** Requests and billed tokens per minute. Limits are per model, so these are separate from embeddings'. */
  rateLimit: { rpm: number; tpm: number }
}

export type RerankSettings = VoyageRerankSettings

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export interface RetrievalSettings {
  /** The same values as Strategy in @docs-rag-lab/contracts; core checks that they match. */
  strategy: 'vector' | 'hybrid' | 'rerank'
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
  rerank: RerankSettings
  models: {
    answer: string
    contextualize: string
    /** Grades answers in eval. Not the model that answers, so it does not grade itself. */
    judge: string
  }
  answer: { effort: Effort; maxTokens: number }
  /** Answer metrics in eval (ADR-0012). */
  evalAnswers: {
    judge: { effort: Effort; maxTokens: number }
    /** Calls at once. Latency is reported, so this stays small. */
    concurrency: number
    /** A run stops before the next paid call past this, and refuses a forecast above it. */
    maxUsd: number
  }
  retrieval: RetrievalSettings
  pricing: PricingSettings
}

export function defineSettings(settings: Settings): Settings {
  return settings
}
