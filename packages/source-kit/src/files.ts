import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import type { Source, SourceFile } from './types.ts'

const BOM = String.fromCodePoint(0xfeff)

/**
 * LF line endings and no BOM, so hashes and code blocks do not depend on how
 * upstream (or git on Windows) stores line endings (ADR-0004).
 */
export function normalizeText(content: string): string {
  const text = content.startsWith(BOM) ? content.slice(BOM.length) : content
  return text.replace(/\r\n?/g, '\n')
}

const toPosix = (path: string): string => path.split(sep).join('/')

/** Reads one repo-relative file from a checkout or fixture tree. */
export function readSourceFile(rootDir: string, path: string): SourceFile {
  return { path, content: normalizeText(readFileSync(join(rootDir, path), 'utf8')) }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/**
 * Every file under the source's include paths that `source.match` accepts,
 * sorted by path. Missing include directories are skipped.
 */
export function listSourceFiles(
  rootDir: string,
  source: Pick<Source, 'include' | 'match'>,
): SourceFile[] {
  const paths = new Set<string>()
  for (const include of source.include) {
    const dir = join(rootDir, include)
    if (!isDirectory(dir)) continue
    for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue
      const path = toPosix(relative(rootDir, join(entry.parentPath, entry.name)))
      if (source.match(path)) paths.add(path)
    }
  }
  return [...paths].sort().map((path) => readSourceFile(rootDir, path))
}
