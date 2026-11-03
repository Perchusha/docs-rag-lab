// Public entry of @docs-rag-lab/ui: client components for the docs assistants.
// Client-safe: of the internal packages it imports only contracts (ADR-0006).
// An app renders DocsAssistant from a server component; its parts stay inside.
export { defineDocsApp, type DocsAppConfig } from './app-config.ts'
export { DocsAssistant, type DocsAssistantProps, type Theme } from './DocsAssistant.tsx'
export { EvalDashboard, type EvalDashboardProps } from './eval/EvalDashboard.tsx'
export type { EvalEndpoints, EvalTransport } from './lib/eval-transport.ts'
export { fetchTransport, readEvents, type Endpoints, type Transport } from './lib/transport.ts'
