import type { EmbeddingsConfig } from '../config.ts'
import type { EmbeddingProvider } from './provider.ts'
import { createVoyageProvider } from './voyage.ts'

export interface ProviderKeys {
  /** Checked by the caller (the CLI's requireKey). */
  voyage: string
}

/**
 * The provider named in config. Voyage is the only one today; a local model
 * becomes a second `provider` value and a switch here.
 */
export function createEmbeddingProvider(
  config: EmbeddingsConfig,
  keys: ProviderKeys,
): EmbeddingProvider {
  return createVoyageProvider(config, keys.voyage)
}
