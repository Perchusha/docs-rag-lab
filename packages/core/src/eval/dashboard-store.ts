// The dashboard's data from the files on disk (ADR-0013). Only reading: no API call, no key,
// and the index is looked at without opening it for use, so a page view changes nothing.
import { readFileSync } from 'node:fs'

import type {
  DashboardDetails,
  DashboardRun,
  DashboardRunComparison,
  DashboardRunEntry,
  DashboardRunList,
} from '@docs-rag-lab/contracts'
import { readIndexCommit } from '@docs-rag-lab/db'

import { sourceIndexPath } from '../indexes.ts'
import { buildDashboardDetails, buildDashboardRun, compareDashboardRuns } from './dashboard.ts'
import { parseGoldenSet } from './golden.ts'
import {
  goldenSetPath,
  listRuns,
  readCalibrations,
  readRun,
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
    : { shown: defaultRun(runs), missing: id }
}

export function loadDashboardRun(store: DashboardStore, id: string): DashboardRun {
  const { root, sourceId, dataDir } = store
  const { rounds, unreadable } = readCalibrations(root, sourceId)
  return buildDashboardRun({
    id,
    report: readRun(root, sourceId, id),
    calibrations: rounds,
    unreadableCalibrations: unreadable,
    verify: readVerifyRecord(root, sourceId, id),
    indexDocsSha: readIndexCommit(sourceIndexPath(dataDir, sourceId)),
  })
}

export function loadDashboardDetails(store: DashboardStore, id: string): DashboardDetails {
  const { root, sourceId } = store
  const { rounds, unreadable } = readCalibrations(root, sourceId)
  return buildDashboardDetails({
    report: readRun(root, sourceId, id),
    questions: parseGoldenSet(readFileSync(goldenSetPath(root, sourceId), 'utf8')),
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
