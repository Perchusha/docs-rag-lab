// What the docs apps share on the server (ADR-0016): their routes as plain functions from a Request
// to a Response, the engine's one instance and where the eval reports are. An app keeps its config,
// theme, pages and one-line routes, and builds its source, since this package imports no source.
export { appSource, onceEngine, type SourceBuilders } from './engine.ts'
export { handleEvalCompare, handleEvalDetails, handleEvalRun } from './eval-handlers.ts'
export { evalStore } from './eval-store.ts'
export {
  handleAsk,
  handleDocument,
  handleSearch,
  type EngineFactory,
  type RouteEngine,
} from './handlers.ts'
