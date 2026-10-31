import type { EmbeddingsConfig } from '../config.ts'
import type { EmbeddingProvider } from './provider.ts'
import { createVoyageProvider } from './voyage.ts'

export interface ProviderKeys {
  voyage?: string | undefined
}

/**
 * The provider named in config. Voyage is the only one today; a local model
 * becomes a second `provider` value and a switch here.
 */
export function createEmbeddingProvider(
  config: EmbeddingsConfig,
  keys: ProviderKeys,
): EmbeddingProvider {
  if (keys.voyage === undefined || keys.voyage === '') {
    throw new Error('VOYAGE_API_KEY is not set (see .env.example)')
  }
  return createVoyageProvider(config, keys.voyage)
}
