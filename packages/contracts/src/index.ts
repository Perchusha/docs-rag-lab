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
