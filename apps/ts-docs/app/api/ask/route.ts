import { appEngine } from '../../../src/server/engine.ts'
import { handleAsk } from '../../../src/server/handlers.ts'

export const dynamic = 'force-dynamic'

export function POST(request: Request): Promise<Response> {
  return handleAsk(appEngine, request)
}
