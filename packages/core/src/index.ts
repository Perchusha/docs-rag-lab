// Public entry of @docs-rag-lab/core: embeddings, ingest, retrieval and
// generation (SPEC section 9). Sources are passed in; core never imports one.
export {
  defineConfig,
  type DrlConfig,
  type Effort,
  type EmbeddingsConfig,
  type ModelPrice,
  type PricingConfig,
  type VoyageEmbeddingsConfig,
} from './config.ts'
export {
  formatUsage,
  UsageMeter,
  type CostEstimate,
  type MessageUsage,
  type ModelUsage,
} from './usage.ts'
export {
  embeddingCacheKey,
  EmbeddingRequestError,
  type EmbeddingProvider,
  type EmbedResult,
  type InputType,
  type RateLimitProbe,
} from './embeddings/provider.ts'
export { RateLimiter, systemClock, type Clock, type Slot } from './embeddings/rate-limit.ts'
export {
  batchForProvider,
  embedWithCache,
  type EmbedProgress,
  type EmbedWithCacheOptions,
} from './embeddings/cached.ts'
export { createVoyageProvider, type VoyageEmbedApi } from './embeddings/voyage.ts'
export { createEmbeddingProvider } from './embeddings/factory.ts'
export { embeddingCachePath, openIndexes, sourceIndexPath, type OpenIndexes } from './indexes.ts'
export { syncSource, type SyncProgress, type SyncReport, type SyncSourceOptions } from './ingest.ts'
export { vectorSearch, type VectorSearchOptions } from './retrieve.ts'
export {
  ANSWER_SYSTEM_PROMPT,
  buildAnswerRequest,
  citationSource,
  citationTitle,
  CitationNumbering,
  createClaudeClient,
  streamAnswer,
  toSearchResult,
  type AnswerRequestOptions,
  type AnswerStream,
  type NumberedCitation,
  type StreamHandlers,
} from './generate.ts'
export type { SearchHit } from '@docs-rag-lab/db'
