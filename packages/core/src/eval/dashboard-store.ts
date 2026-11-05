// The dashboard's data from the files on disk (ADR-0013). Only reading: no API call, no key,
// and the index is looked at without opening it for use, so a page view changes nothing.
import { readFileSync } from 'node:fs'

import type {
  DashboardDetails,
  DashboardRun,
  DashboardRunComparison,
  DashboardRunEntry,
  DashboardRunList,
  EvalReport,
  EvalStrategyResult,
} from '@docs-rag-lab/contracts'
import { readIndexCommit } from '@docs-rag-lab/db'

import { sourceIndexPath } from '../indexes.ts'
import { buildDashboardDetails, buildDashboardRun, compareDashboardRuns } from './dashboard.ts'
import { parseGoldenSet } from './golden.ts'
import {
  goldenSetPath,
  goldenSetPathFor,
  listRuns,
  readCalibrations,
  readRun,
  readSourceAbout,
  readSpotCheck,
  readVerifyRecord,
} from './report-store.ts'

export interface DashboardStore {
  root: string
  /** Where the index is, for the commit it is at now. */
  dataDir: string
  sourceId: string
}

export function dashboardRuns(store: DashboardStore): DashboardRunList {
  return listRuns(store.root, store.sourceId)
}

/** The run to show first: the newest with answers, or else the newest. */
export function defaultRun(runs: readonly DashboardRunEntry[]): DashboardRunEntry | undefined {
  return runs.find(({ hasAnswers }) => hasAnswers) ?? runs[0]
}

/** The run a page asks for, or the default, with what it asked for if no run has that name. */
export function runToShow(
  runs: readonly DashboardRunEntry[],
  asked: string | string[] | undefined,
): { shown: DashboardRunEntry | undefined; missing: string | undefined } {
  const id = Array.isArray(asked) ? asked[0] : asked
  const found = runs.find((run) => run.id === id)
  return found !== undefined
    ? { shown: found, missing: undefined }
    : { shown: defaultRun(runs), missing: id === '' ? undefined : id }
}

export interface DashboardPage extends DashboardRunList {
  /** The run to show first, or undefined when none can be shown. */
  initial: DashboardRun | undefined
  /** What the address asked for, when no run has that name. */
  missing: string | undefined
}

/**
 * What the page shows. A report that lists and then does not build is named with those that
 * could not be read, and the next run shows instead: one bad file never takes the page down.
 */
export function dashboardPage(
  store: DashboardStore,
  asked: string | string[] | undefined,
): DashboardPage {
  const list = dashboardRuns(store)
  const unreadable = [...list.unreadable]
  let { runs } = list
  const chosen = runToShow(runs, asked)
  // A report that exists and cannot be read is not a run that does not exist.
  const missing =
    chosen.missing !== undefined && unreadable.includes(chosen.missing) ? undefined : chosen.missing
  let shown = chosen.shown
  while (shown !== undefined) {
    const { id } = shown
    try {
      return { runs, unreadable, initial: loadDashboardRun(store, id), missing }
    } catch {
      unreadable.push(id)
      runs = runs.filter((run) => run.id !== id)
      shown = defaultRun(runs)
    }
  }
  return { runs, unreadable, initial: undefined, missing }
}

/**
 * Row 5's retrieval. A report has one index, so it lives in the report of the contextual index
 * (ADR-0014): the one that names the chunks row 5 read, for the same questions and reranker.
 */
function contextualRetrieval(
  store: DashboardStore,
  report: EvalReport,
): EvalStrategyResult | undefined {
  const index = report.answers?.contextualIndex
  if (index === undefined) return undefined
  const { root, sourceId } = store
  for (const { id } of listRuns(root, sourceId).runs) {
    const other = readRun(root, sourceId, id)
    const same =
      other.identity.chunksHash === index.chunksHash &&
      other.vectors.queryHash === report.vectors.queryHash &&
      other.identity.goldenSet.hash === report.identity.goldenSet.hash &&
      JSON.stringify(other.identity.rerank) === JSON.stringify(report.identity.rerank)
    const found = same
      ? other.result.strategies.find(({ strategy }) => strategy === 'rerank')
      : undefined
    if (found !== undefined) return found
  }
  return undefined
}

export function loadDashboardRun(store: DashboardStore, id: string): DashboardRun {
  const { root, sourceId, dataDir } = store
  const { rounds, unreadable } = readCalibrations(root)
  const report = readRun(root, sourceId, id)
  return buildDashboardRun({
    id,
    report,
    contextual: contextualRetrieval(store, report),
    calibrations: rounds,
    unreadableCalibrations: unreadable,
    verify: readVerifyRecord(root, sourceId, id),
    spotCheck: readSpotCheck(root, sourceId, id),
    about: readSourceAbout(root, sourceId),
    indexDocsSha: readIndexCommit(sourceIndexPath(dataDir, sourceId)),
  })
}

export function loadDashboardDetails(store: DashboardStore, id: string): DashboardDetails {
  const { root, sourceId } = store
  const { rounds, unreadable } = readCalibrations(root)
  const report = readRun(root, sourceId, id)
  return buildDashboardDetails({
    report,
    contextual: contextualRetrieval(store, report),
    // The questions of the set the report names, which a later version can have changed.
    questions: parseGoldenSet(
      readFileSync(
        goldenSetPathFor(root, sourceId, report.identity.goldenSet.hash) ??
          goldenSetPath(root, sourceId),
        'utf8',
      ),
    ),
    calibrations: rounds,
    unreadableCalibrations: unreadable,
  })
}

export function loadRunComparison(
  store: DashboardStore,
  a: string,
  b: string,
): DashboardRunComparison {
  const { root, sourceId } = store
  return compareDashboardRuns(readRun(root, sourceId, a), readRun(root, sourceId, b))
}
