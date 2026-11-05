import { handleDocument } from '@docs-rag-lab/docs-server'

import { appEngine } from '../../../src/server.ts'

export const dynamic = 'force-dynamic'

export function GET(request: Request): Response {
  return handleDocument(appEngine, request)
}
