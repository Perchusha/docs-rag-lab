// The eval dashboard's routes (ADR-0013), as plain functions from a Request to a Response. They
// read committed files and nothing else: no engine, no key, and nothing that could spend.
import {
  loadDashboardDetails,
  loadDashboardRun,
  loadRunComparison,
  UnknownRunError,
  type DashboardStore,
} from '@docs-rag-lab/core'

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status })
}

function respond(run: () => unknown): Response {
  try {
    return json(run())
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return json({ error: message }, error instanceof UnknownRunError ? 404 : 500)
  }
}

const param = (request: Request, name: string): string | null =>
  new URL(request.url).searchParams.get(name)

export function handleEvalRun(store: DashboardStore, request: Request): Response {
  const run = param(request, 'run')
  if (run === null) return json({ error: 'the run parameter is required' }, 400)
  return respond(() => loadDashboardRun(store, run))
}

export function handleEvalDetails(store: DashboardStore, request: Request): Response {
  const run = param(request, 'run')
  if (run === null) return json({ error: 'the run parameter is required' }, 400)
  return respond(() => loadDashboardDetails(store, run))
}

export function handleEvalCompare(store: DashboardStore, request: Request): Response {
  const a = param(request, 'a')
  const b = param(request, 'b')
  if (a === null || b === null) return json({ error: 'the a and b parameters are required' }, 400)
  return respond(() => loadRunComparison(store, a, b))
}
