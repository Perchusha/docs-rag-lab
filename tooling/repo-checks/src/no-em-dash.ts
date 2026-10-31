// Fails when any text file in the repository contains an em dash (U+2014).
// Runs from `pnpm format:check`, locally and in CI.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { findEmDashes, isBinary, isChecked } from './lib/em-dash.ts'

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()

// Tracked files plus new files that are not ignored, so a local run catches a
// file before `git add`. CI checkouts only contain tracked files.
const files = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  {
    cwd: root,
    encoding: 'utf8',
  },
)
  .split('\0')
  .filter((path) => path !== '' && isChecked(path))

let hits = 0
for (const path of files) {
  let content: Buffer
  try {
    content = readFileSync(join(root, path))
  } catch {
    continue // listed by git but deleted in the working tree
  }
  if (isBinary(content)) continue
  for (const hit of findEmDashes(content.toString('utf8'))) {
    console.error(
      `${path}:${String(hit.line)}:${String(hit.col)}: em dash (U+2014), use a plain hyphen`,
    )
    hits++
  }
}

if (hits > 0) {
  console.error(`\nno-em-dash: ${String(hits)} em dash(es) found.`)
  process.exit(1)
}
console.log(`no-em-dash: ${String(files.length)} files checked, none found.`)
