import { handleEvalDetails } from '@docs-rag-lab/docs-server'

import { appEvalStore } from '../../../../src/server.ts'

export const dynamic = 'force-dynamic'

export function GET(request: Request): Response {
  return handleEvalDetails(appEvalStore(), request)
}
