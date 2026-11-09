import { handleMockSummary } from '@docs-rag-lab/interview-server'

import { appBackend } from '../../../../../src/server.ts'

export const dynamic = 'force-dynamic'

export function GET(request: Request): Response {
  return handleMockSummary(appBackend, request)
}
