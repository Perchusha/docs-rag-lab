// The committed reports on disk, as the dashboard and the CLI read them (ADR-0010, ADR-0013).
// Development runs under dev/ are left out, and calibration and verify files sit next to the
// reports they belong to, told apart by name.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  parseEvalReport,
  type DashboardRunEntry,
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
const SIDECAR = /-(calibration(-[a-z-]+)?|verify)\.json$/

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

/** Every named run, newest first. */
export function listRuns(root: string, sourceId: string): DashboardRunEntry[] {
  return runFiles(root, sourceId)
    .map((file): DashboardRunEntry => {
      const id = file.slice(0, -'.json'.length)
      const report = readRun(root, sourceId, id)
      return {
        id,
        name: report.run.name ?? id,
        createdAt: report.run.createdAt,
        sha: report.run.repoSha.slice(0, 8),
        hasAnswers: report.answers !== undefined,
      }
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
}

/** Every calibration of a source, oldest report first. */
export function readCalibrations(root: string, sourceId: string): EvalCalibration[] {
  return jsonFiles(root, sourceId)
    .filter((name) => /-calibration(-[a-z-]+)?\.json$/.test(name))
    .map((name) => readJson(join(reportsDir(root, sourceId), name)) as EvalCalibration)
    .sort((a, b) => a.report.createdAt.localeCompare(b.report.createdAt))
}

/** What the last recorded re-run of a report found, or null when none was recorded. */
export function readVerifyRecord(
  root: string,
  sourceId: string,
  id: string,
): EvalVerifyRecord | null {
  const path = verifyRecordPath(join(reportsDir(root, sourceId), `${id}.json`))
  return existsSync(path) ? (readJson(path) as EvalVerifyRecord) : null
}
