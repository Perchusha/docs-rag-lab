// How the dashboard reaches its data beyond the first screen. Only reading (ADR-0013). Stories
// pass a fake, so they replay real data and never touch the network.
import type {
  DashboardDetails,
  DashboardRun,
  DashboardRunComparison,
} from '@docs-rag-lab/contracts'

export interface EvalEndpoints {
  run: string
  details: string
  compare: string
}

export interface EvalTransport {
  run(id: string): Promise<DashboardRun>
  details(id: string): Promise<DashboardDetails>
  compare(a: string, b: string): Promise<DashboardRunComparison>
}

async function readJson(url: string): Promise<unknown> {
  const response = await fetch(url)
  const body: unknown = await response.json().catch(() => undefined)
  if (!response.ok) {
    const message =
      typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
        ? body.error
        : `${String(response.status)} ${response.statusText}`.trim()
    throw new Error(message)
  }
  return body
}

export function evalFetchTransport(endpoints: EvalEndpoints): EvalTransport {
  return {
    run: async (id) =>
      (await readJson(`${endpoints.run}?run=${encodeURIComponent(id)}`)) as DashboardRun,
    details: async (id) =>
      (await readJson(`${endpoints.details}?run=${encodeURIComponent(id)}`)) as DashboardDetails,
    compare: async (a, b) =>
      (await readJson(
        `${endpoints.compare}?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`,
      )) as DashboardRunComparison,
  }
}
