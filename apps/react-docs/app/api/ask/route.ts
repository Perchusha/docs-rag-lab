import { handleAsk } from '@docs-rag-lab/docs-server'

import { appEngine } from '../../../src/server.ts'

export const dynamic = 'force-dynamic'

export function POST(request: Request): Promise<Response> {
  return handleAsk(appEngine, request)
}
