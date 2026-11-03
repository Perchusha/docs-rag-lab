// A server component: it reads the committed reports and passes plain data to the dashboard.
// It takes no key, and nothing on the page can spend anything (ADR-0013).
import { dashboardRuns, loadDashboardRun, runToShow } from '@docs-rag-lab/core'
import { EvalDashboard } from '@docs-rag-lab/ui'

import config from '../../rag.config.ts'
import { evalStore } from '../../src/server/eval-store.ts'

export const dynamic = 'force-dynamic'

export default async function EvalPage({
  searchParams,
}: {
  searchParams: Promise<{ run?: string | string[] }>
}) {
  const store = evalStore()
  const { runs, unreadable } = dashboardRuns(store)
  const { shown, missing } = runToShow(runs, (await searchParams).run)
  return (
    <EvalDashboard
      title={`Eval: ${config.title}`}
      runs={runs}
      initial={shown === undefined ? undefined : loadDashboardRun(store, shown.id)}
      missingRun={missing}
      unreadableRuns={unreadable}
      endpoints={{
        run: '/api/eval/run',
        details: '/api/eval/details',
        compare: '/api/eval/compare',
      }}
    />
  )
}
