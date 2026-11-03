// The dashboard's data from the files on disk (ADR-0013). Only reading: no API call, no key.
import { readFileSync } from 'node:fs'

import type {
  DashboardDetails,
  DashboardRun,
  DashboardRunComparison,
  DashboardRunEntry,
} from '@docs-rag-lab/contracts'

import { IndexNotFoundError, openIndexes } from '../indexes.ts'
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

/** The commit the index is at now, or null when there is no index yet. */
function indexDocsSha({ dataDir, sourceId }: DashboardStore): string | null {
  try {
    const indexes = openIndexes(dataDir, sourceId, { create: false })
    try {
      return indexes.index.getManifest()?.commitSha ?? null
    } finally {
      indexes.close()
    }
  } catch (error) {
    if (error instanceof IndexNotFoundError) return null
    throw error
  }
}

export function dashboardRuns(store: DashboardStore): DashboardRunEntry[] {
  return listRuns(store.root, store.sourceId)
}

/** The run to show first: the newest with answers, or else the newest. */
export function defaultRun(runs: readonly DashboardRunEntry[]): DashboardRunEntry | undefined {
  return runs.find(({ hasAnswers }) => hasAnswers) ?? runs[0]
}

export function loadDashboardRun(store: DashboardStore, id: string): DashboardRun {
  const { root, sourceId } = store
  return buildDashboardRun({
    id,
    report: readRun(root, sourceId, id),
    calibrations: readCalibrations(root, sourceId),
    verify: readVerifyRecord(root, sourceId, id),
    indexDocsSha: indexDocsSha(store),
  })
}

export function loadDashboardDetails(store: DashboardStore, id: string): DashboardDetails {
  const { root, sourceId } = store
  return buildDashboardDetails({
    report: readRun(root, sourceId, id),
    questions: parseGoldenSet(readFileSync(goldenSetPath(root, sourceId), 'utf8')),
    calibrations: readCalibrations(root, sourceId),
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
