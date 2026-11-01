import type { EmbeddingsSettings } from '@docs-rag-lab/settings'

import type { EmbeddingProvider } from './provider.ts'
import { createVoyageProvider } from './voyage.ts'

/**
 * The provider named in settings. Voyage is the only one today; a local model
 * becomes a second `provider` value and a switch here. The provider reads its
 * API key from the environment when it is created (ADR-0007).
 */
export function createEmbeddingProvider(settings: EmbeddingsSettings): EmbeddingProvider {
  return createVoyageProvider(settings)
}
