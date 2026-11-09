import { handleMockStart } from '@docs-rag-lab/interview-server'

import { appBackend } from '../../../../src/server.ts'

export const dynamic = 'force-dynamic'

export function POST(request: Request): Promise<Response> {
  return handleMockStart(appBackend, request)
}
