// Public entry of @docs-rag-lab/interview-server: the interview-prep app's routes as plain
// functions from a Request to a Response, and its one backend (ADR-0018). Like docs-server, it
// imports core, contracts and settings, and never ui, db or a source: the app builds its sources.
export { onceInterview, statePath, type BackendOptions } from './backend.ts'
export {
  handleDeck,
  handleFlag,
  handleOverview,
  handleReview,
  MAX_DECK,
  QUICK_DECK,
  type BackendFactory,
  type InterviewBackend,
} from './handlers.ts'
export {
  handleCheck,
  handleMockAnswer,
  handleMockStart,
  handleMockSummary,
} from './mock-handlers.ts'
