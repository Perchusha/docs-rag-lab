import { handleFlag } from '@docs-rag-lab/interview-server'

import { appBackend } from '../../../../src/server.ts'

export const dynamic = 'force-dynamic'

export function POST(request: Request): Promise<Response> {
  return handleFlag(appBackend, request)
}
