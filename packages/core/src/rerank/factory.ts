import type { RerankSettings } from '@docs-rag-lab/settings'

import type { RerankProvider } from './provider.ts'
import { createVoyageReranker } from './voyage.ts'

/** The reranker named in settings. It reads its API key when it is created (ADR-0007). */
export function createRerankProvider(settings: RerankSettings): RerankProvider {
  return createVoyageReranker(settings)
}
