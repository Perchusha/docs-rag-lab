// Public entry of @docs-rag-lab/source-kit: the Source contract, git sync,
// hashing, chunking and the conformance suite (SPEC section 7, ADR-0003).
export {
  DOC_TYPES,
  type Block,
  type DocType,
  type License,
  type ParseContext,
  type ParsedDoc,
  type Section,
  type Source,
  type SourceFile,
} from './types.ts'
export { sha256Hex } from './hash.ts'
export { estimateTokens } from './tokens.ts'
export {
  CHUNKER_VERSION,
  DEFAULT_MAX_TOKENS,
  chunkDocument,
  chunkId,
  packBalanced,
  renderBlock,
  type Chunk,
  type ChunkOptions,
} from './chunker.ts'
export { listSourceFiles, normalizeText, readSourceFile } from './files.ts'
export { git, GitError } from './git.ts'
export { parseNameStatus, syncRepo, type SyncRepoOptions, type SyncRepoResult } from './sync.ts'
export {
  runSourceConformance,
  type ConformanceFixtures,
  type ConformanceReport,
} from './conformance.ts'
