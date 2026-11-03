import { handleEvalDetails } from '../../../../src/server/eval-handlers.ts'
import { evalStore } from '../../../../src/server/eval-store.ts'

export const dynamic = 'force-dynamic'

export function GET(request: Request): Response {
  return handleEvalDetails(evalStore(), request)
}
