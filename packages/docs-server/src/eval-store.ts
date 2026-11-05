// Where an app's eval reports and index are.
import { join } from 'node:path'

import { findRepoRoot, type DashboardStore } from '@docs-rag-lab/core'
import { settings } from '@docs-rag-lab/settings'

export function evalStore(sourceId: string): DashboardStore {
  const root = findRepoRoot(process.cwd())
  return { root, dataDir: join(root, settings.dataDir), sourceId }
}
