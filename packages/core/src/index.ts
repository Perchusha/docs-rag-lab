// Public entry of @docs-rag-lab/core: embeddings, ingest, retrieval, generation
// and eval (SPEC sections 9 and 10). Sources are passed in; core never imports one.
export { findRepoRoot, loadRootEnv, MissingKeyError, requireKey, type KeyName } from './env.ts'
export {
  formatUsage,
  UsageMeter,
  type CostEstimate,
  type MessageUsage,
  type ModelUsage,
} from './usage.ts'
export {
  ProviderRequestError,
  requestWithRetries,
  type ProviderRequestOptions,
} from './provider-request.ts'
export {
  embeddingCacheKey,
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
export { estimateRerankTokens, type RerankProvider, type RerankResult } from './rerank/provider.ts'
export {
  rerankCacheKey,
  RerankRejectedError,
  rerankWithCache,
  type RerankWithCacheOptions,
} from './rerank/cached.ts'
export { createVoyageReranker, type VoyageRerankApi } from './rerank/voyage.ts'
export { createRerankProvider } from './rerank/factory.ts'
export {
  batchForRerank,
  compositionsOf,
  planBatchingCheck,
  runBatchingCheck,
  type BatchingCheck,
  type BatchingCheckOptions,
  type BatchingCheckQuestion,
  type Composition,
  type CompositionName,
  type CompositionResult,
  type QuestionCheck,
  type SetComparison,
} from './rerank/batching-check.ts'
export {
  contextIdentity,
  contextPromptHash,
  ContextsStoppedError,
  forecastContexts,
  generateContexts,
  pilotChunks,
  planContexts,
  type ContextChunk,
  type ContextDocument,
  type ContextPlan,
  type GenerateContextsOptions,
  type PlanContextsOptions,
} from './contexts/generate.ts'
export {
  appendContext,
  contextsPath,
  readContexts,
  writeContexts,
  type ContextsHeader,
  type StoredContext,
} from './contexts/store.ts'
export { checkVariantIndex, type VariantIndexCheck } from './contexts/check.ts'
export {
  CONTROL_IDENTITY,
  controlContexts,
  headingPrefix,
  variantOfContextModel,
} from './contexts/control.ts'
export { contextualText } from './contexts/text.ts'
export {
  variantIndexPath,
  embeddingCachePath,
  IndexNotFoundError,
  openIndexes,
  rerankCachePath,
  sourceIndexPath,
  type IndexVariant,
  type OpenIndexes,
  type OpenIndexesOptions,
} from './indexes.ts'
export {
  contextDocumentsAt,
  syncSource,
  type SyncContexts,
  type SyncProgress,
  type SyncReport,
  type SyncSourceOptions,
} from './ingest.ts'
export { retrieve, type RerankStep, type Retrieval, type RetrieveOptions } from './retrieve.ts'
export { ask, usageSummary, type AskOptions } from './ask.ts'
export {
  createEngine,
  InvalidRequestError,
  MAX_TOP_K,
  UnknownSourceError,
  type AskRun,
  type Engine,
  type EngineOptions,
  type EngineSettings,
} from './engine.ts'
export {
  anchorKey,
  goldenSetHash,
  GOLDEN_TAGS,
  GoldenSetError,
  parseGoldenSet,
  type AnchorRef,
  type GoldenQuestion,
  type GoldenTag,
} from './eval/golden.ts'
export {
  checkGoldenSet,
  parseGoldenLock,
  resolveAnchor,
  sectionAnchorsOf,
  type AnchorChunk,
  type AnchorFinding,
  type AnchorIndex,
  type AnchorProblem,
  type AnchorResolution,
  type CheckGoldenSetOptions,
  type GoldenCheck,
  type GoldenLock,
} from './eval/anchors.ts'
export { CONTEXT_CUTOFF } from './eval/metrics.ts'
export { compareScores } from './eval/compare.ts'
export {
  parseEvalTargets,
  runRetrievalEval,
  vectorsHash,
  type EvalTarget,
  type RetrievalEvalOptions,
} from './eval/run.ts'
export { fieldDifferences, verifyReport, type EvalVerification } from './eval/verify.ts'
export { readRepoState, type RepoState } from './eval/repo-state.ts'
export {
  guardEmbeddings,
  guardReranker,
  RunMovedError,
  startRunGuard,
  type RunGuard,
} from './run-guard.ts'
export {
  cachedAnswer,
  claimsOf,
  judgeCallsOf,
  EvalStoppedError,
  noRagSystemPrompt,
  planAnswers,
  promptHash,
  requestKey,
  NOISE_ROWS,
  ROW_STRATEGY,
  ROW_VARIANT,
  rowRequest,
  runAnswers,
  runJudge,
  type AnswerJob,
  type AnswerSettings,
  type EvalClient,
  type JudgeOptions,
  type JudgeResult,
  type PlanOptions,
  type RunnerOptions,
} from './eval/answers.ts'
export {
  anchorCandidates,
  compareRows,
  judgeRetest,
  rowResult,
  type AnswerResultsOptions,
} from './eval/answer-metrics.ts'
export {
  calibrate,
  cohensKappa,
  LABEL_SEED,
  freshSampleForLabels,
  newRowsSampleForLabels,
  sampleForLabels,
  sampleHash,
  wilsonInterval,
  type CalibrateOptions,
  type FreshSampleOptions,
  type SampleOptions,
} from './eval/calibrate.ts'
export {
  estimateCost,
  type EvalCostEstimate,
  type CostLine,
  type EstimateOptions,
} from './eval/cost.ts'
export { bootstrapMean, seeded } from './eval/bootstrap.ts'
export {
  buildDashboardDetails,
  buildDashboardRun,
  compareDashboardRuns,
  meanFigure,
  shareFigure,
  splitOf,
  type BuildDetailsOptions,
  type BuildRunOptions,
} from './eval/dashboard.ts'
export {
  goldenSetPath,
  isSidecarName,
  listRuns,
  readCalibrations,
  reportSources,
  readRun,
  readVerifyRecord,
  reportsDir,
  UnknownRunError,
  verifyRecordPath,
  type CalibrationFiles,
} from './eval/report-store.ts'
export { judgeSentence, judgeTrust, verifyWords } from './eval/trust.ts'
export {
  dashboardPage,
  dashboardRuns,
  defaultRun,
  loadDashboardDetails,
  loadDashboardRun,
  loadRunComparison,
  runToShow,
  type DashboardPage,
  type DashboardStore,
} from './eval/dashboard-store.ts'
export {
  judgeCases,
  runJudgeCheck,
  type JudgeCase,
  type JudgeCaseResult,
} from './eval/judge-check.ts'
export {
  correctnessRequest,
  CORRECTNESS_SYSTEM_PROMPT,
  isUnanswerable,
  JudgeOutputError,
  parseCorrectness,
  parseRefusal,
  parseSupport,
  REFUSAL_SYSTEM_PROMPT,
  refusalRequest,
  SUPPORT_SYSTEM_PROMPT,
  supportRequest,
  type JudgeSettings,
} from './eval/judge.ts'
export { analyzeQuery, MIN_TERM_LENGTH, quoteTerm, type QueryPlan } from './query.ts'
export { fuseRrf, type FusedCandidate, type RankedList } from './rrf.ts'
export {
  ANSWER_SYSTEM_PROMPT,
  buildAnswerRequest,
  citationSource,
  citationTitle,
  sectionPartOf,
  sectionPathOf,
  CitationNumbering,
  createClaudeClient,
  streamAnswer,
  toSearchResult,
  type AnswerClient,
  type AnswerRequestOptions,
  type AnswerStream,
  type StreamHandlers,
} from './generate.ts'
export type { SearchHit } from '@docs-rag-lab/db'
export { openEvalCache, readIndexCommit, type EvalCache } from '@docs-rag-lab/db'
export {
  CHUNKER_VERSION,
  DOC_TYPES,
  estimateTokens,
  type DocType,
  type Source,
} from '@docs-rag-lab/source-kit'
