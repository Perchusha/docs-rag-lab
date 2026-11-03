// Where this app's eval reports and index are.
import { join } from 'node:path'

import { findRepoRoot, type DashboardStore } from '@docs-rag-lab/core'
import { settings } from '@docs-rag-lab/settings'

import config from '../../rag.config.ts'

export function evalStore(): DashboardStore {
  const root = findRepoRoot(process.cwd())
  return { root, dataDir: join(root, settings.dataDir), sourceId: config.source }
}
