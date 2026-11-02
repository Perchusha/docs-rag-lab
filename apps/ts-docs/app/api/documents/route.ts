import { appEngine } from '../../../src/server/engine.ts'
import { handleDocument } from '../../../src/server/handlers.ts'

export const dynamic = 'force-dynamic'

export function GET(request: Request): Response {
  return handleDocument(appEngine, request)
}
