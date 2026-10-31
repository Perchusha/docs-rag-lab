import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

// Code and config files that lint, typecheck or depcruise can be affected by.
// Markdown and other prose are skipped.
const CHECKED_FILE = /\.(?:ts|tsx|js|jsx|mjs|cjs|json)$/i

export function isCheckedFile(filePath: string): boolean {
  return CHECKED_FILE.test(filePath) && !/[\\/]node_modules[\\/]/.test(filePath)
}

export interface WorkspacePackage {
  name: string
  dir: string
}

function packageName(manifestPath: string): string | undefined {
  let manifest: unknown
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`${manifestPath} is not valid JSON: ${reason}`, { cause: error })
  }
  if (typeof manifest !== 'object' || manifest === null || !('name' in manifest)) return undefined
  return typeof manifest.name === 'string' ? manifest.name : undefined
}

/**
 * The workspace package that owns `filePath`: the nearest package.json below
 * the project root. Returns null for files outside any package, including
 * files that only the root package.json covers.
 */
export function findWorkspacePackage(
  filePath: string,
  projectDir: string,
): WorkspacePackage | null {
  const root = resolve(projectDir)
  for (let dir = dirname(resolve(filePath)); ; dir = dirname(dir)) {
    const fromRoot = relative(root, dir)
    if (fromRoot === '' || fromRoot.startsWith('..') || isAbsolute(fromRoot)) return null
    const manifest = join(dir, 'package.json')
    if (existsSync(manifest)) {
      const name = packageName(manifest)
      return name === undefined ? null : { name, dir }
    }
  }
}
