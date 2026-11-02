// Public entry of @docs-rag-lab/contracts: the data shapes that cross package
// and process boundaries (ADR-0006). Client-safe: this package imports nothing,
// not even Node built-ins, so ui may use it.
export {
  LIST_NAMES,
  STRATEGIES,
  TRACE_VERSION,
  type ExactToken,
  type ExactTokenOrigin,
  type ListName,
  type RetrievalTrace,
  type Strategy,
  type TraceCandidate,
  type TraceChunk,
  type TraceContextChunk,
  type TraceFusedCandidate,
  type TraceFusion,
  type TraceList,
} from './trace.ts'
export {
  NO_CONTEXT,
  type AnswerEvent,
  type Citation,
  type ModelUsageSummary,
  type RetrievalRequest,
  type UsageSummary,
} from './answer.ts'
export type { DocumentChunk, DocumentChunks } from './document.ts'
export {
  encodeEvent,
  EventDecoder,
  NDJSON_CONTENT_TYPE,
  parseEvent,
  StreamFormatError,
} from './ndjson.ts'
export { MAX_QUESTION_LENGTH, parseRetrievalRequest, type Parsed } from './requests.ts'
