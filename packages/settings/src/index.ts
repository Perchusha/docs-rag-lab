// Public entry of @docs-rag-lab/settings: the engine settings that the CLI and
// every app share, and their schema (ADR-0007). A leaf: it imports no internal
// package, and ui may not import it.
export { settings } from './settings.ts'
export {
  defineSettings,
  type Effort,
  type EmbeddingsSettings,
  type ModelPrice,
  type PricingSettings,
  type RetrievalSettings,
  type Settings,
  type SourceSettings,
  type VoyageEmbeddingsSettings,
} from './types.ts'
