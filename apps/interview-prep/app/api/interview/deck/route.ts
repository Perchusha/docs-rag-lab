import { handleDeck } from '@docs-rag-lab/interview-server'

import { appBackend } from '../../../../src/server.ts'

export const dynamic = 'force-dynamic'

export function GET(request: Request): Response {
  return handleDeck(appBackend, request)
}
