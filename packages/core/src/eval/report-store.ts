// The committed reports on disk, as the dashboard and the CLI read them (ADR-0010, ADR-0013).
// Development runs under dev/ are left out, and calibration and verify files sit next to the
// reports they belong to, told apart by name, which is why a run cannot take such a name. One
// file that cannot be read loses only itself, and the page says which.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  parseEvalCalibration,
  parseEvalReport,
  parseEvalVerifyRecord,
  type DashboardRunEntry,
  type DashboardRunList,
  type EvalCalibration,
  type EvalReport,
  type EvalVerifyRecord,
} from '@docs-rag-lab/contracts'

export function reportsDir(root: string, sourceId: string): string {
  return join(root, 'eval', 'reports', sourceId)
}

export function goldenSetPath(root: string, sourceId: string): string {
  return join(root, 'packages', 'sources', sourceId, 'eval', 'questions.jsonl')
}

/** Where a report's verify record goes, from the report's own path. */
export function verifyRecordPath(reportPath: string): string {
  return reportPath.replace(/\.json$/, '-verify.json')
}

const RUN_FILE = /^(\d{4}-\d{2}-\d{2})-([0-9a-f]{8})-(.+)\.json$/
const CALIBRATION = /-calibration(-[a-z-]+)?\.json$/
const SIDECAR = /-(calibration(-[a-z-]+)?|verify)\.json$/

/** A run of this name would be read as a calibration or verify file, or lost among them. */
export function isSidecarName(name: string): boolean {
  return SIDECAR.test(`-${name}.json`)
}

/** A run the store does not have. The message is safe to show. */
export class UnknownRunError extends Error {
  constructor(id: string) {
    super(`there is no run "${id}"`)
    this.name = 'UnknownRunError'
  }
}

function jsonFiles(root: string, sourceId: string): string[] {
  const dir = reportsDir(root, sourceId)
  return existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith('.json')) : []
}

function runFiles(root: string, sourceId: string): string[] {
  return jsonFiles(root, sourceId).filter((name) => RUN_FILE.test(name) && !SIDECAR.test(name))
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/**
 * Reads a run by its ID, the file name without .json. The ID must be one the store lists, so
 * a request cannot reach any other path.
 */
export function readRun(root: string, sourceId: string, id: string): EvalReport {
  const file = `${id}.json`
  if (!runFiles(root, sourceId).includes(file)) throw new UnknownRunError(id)
  const parsed = parseEvalReport(readJson(join(reportsDir(root, sourceId), file)))
  if (!parsed.ok) throw new Error(`${file}: ${parsed.error}`)
  return parsed.value
}

/** Every named run, newest first, and those that could not be read. */
export function listRuns(root: string, sourceId: string): DashboardRunList {
  const runs: DashboardRunEntry[] = []
  const unreadable: string[] = []
  for (const file of runFiles(root, sourceId)) {
    const id = file.slice(0, -'.json'.length)
    try {
      const report = readRun(root, sourceId, id)
      runs.push({
        id,
        name: report.run.name ?? id,
        createdAt: report.run.createdAt,
        sha: report.run.repoSha.slice(0, 8),
        hasAnswers: report.answers !== undefined,
      })
    } catch {
      unreadable.push(id)
    }
  }
  runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
  return { runs, unreadable }
}

/** Every source with a folder of reports. */
export function reportSources(root: string): string[] {
  const dir = join(root, 'eval', 'reports')
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map(({ name }) => name)
    .sort()
}

export interface CalibrationFiles {
  rounds: EvalCalibration[]
  unreadable: string[]
}

/**
 * Every calibration of every source, oldest first: by report, and on one report by file, where the
 * first round's name is the start of a later one's. The order is what lets the latest decide. They
 * are about the judge and not the docs, so a report takes the rounds of its prompts and model from
 * wherever they were labelled (ADR-0015), and the store notes which source that was.
 */
export function readCalibrations(root: string): CalibrationFiles {
  const read: { stem: string; round: EvalCalibration }[] = []
  const unreadable: string[] = []
  for (const sourceId of reportSources(root)) {
    for (const name of jsonFiles(root, sourceId).filter((file) => CALIBRATION.test(file))) {
      const stem = name.slice(0, -'.json'.length)
      try {
        const parsed = parseEvalCalibration(readJson(join(reportsDir(root, sourceId), name)))
        if (parsed.ok) read.push({ stem, round: { ...parsed.value, sourceId } })
        else unreadable.push(stem)
      } catch {
        unreadable.push(stem)
      }
    }
  }
  read.sort(
    (a, b) =>
      a.round.report.createdAt.localeCompare(b.round.report.createdAt) ||
      (a.stem < b.stem ? -1 : a.stem > b.stem ? 1 : 0),
  )
  return { rounds: read.map(({ round }) => round), unreadable }
}

/** What the last recorded re-run of a report found, or null when none can be read. */
export function readVerifyRecord(
  root: string,
  sourceId: string,
  id: string,
): EvalVerifyRecord | null {
  const path = verifyRecordPath(join(reportsDir(root, sourceId), `${id}.json`))
  if (!existsSync(path)) return null
  try {
    const parsed = parseEvalVerifyRecord(readJson(path))
    return parsed.ok ? parsed.value : null
  } catch {
    return null
  }
}
