import { posix } from 'node:path'

import { stringField, type HookInput } from './hook-io.ts'

export type Decision = { allowed: true } | { allowed: false; reason: string }

const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const FILE_TOOLS = new Set(['Read', ...WRITE_TOOLS])
const SEARCH_TOOLS = new Set(['Grep', 'Glob'])
const SHELL_TOOLS = new Set(['Bash', 'PowerShell'])

// Directories that only the tools themselves write (SPEC section 4).
const GENERATED_DIRS = ['data', '.cache']

// The one .env* file that documents variables and holds no secrets.
const ALLOWED_ENV_FILES = new Set(['.env.example'])

// `.env` as a file name, not a substring. It counts unless it directly follows
// a word character, `$` or `.`: so `.env`, `./.env.local`, `cat .env`,
// `--env-file=.env`, `cat<.env` and `-Path:.env` match, while `process.env`,
// `import.meta.env` and `production.env` do not. The name runs to the next
// separator, so `.envrc` matches too (the `.env*` glob). Case-insensitive,
// because NTFS opens `.ENV` as `.env`.
const ENV_FILE = /(?<![\w$.])\.env[^\\/\s'"=:;,|&<>(){}[\]`]*/gi

/** The `.env*` file names that `text` refers to, except `.env.example`. */
export function referencedEnvFiles(text: string): string[] {
  return [...text.matchAll(ENV_FILE)]
    .map((match) => match[0])
    .filter((name) => !ALLOWED_ENV_FILES.has(name.toLowerCase()))
}

function normalize(path: string): string {
  let normalized = path.replaceAll('\\', '/')
  // Win32 namespace prefix: //?/D:/x and //./D:/x mean D:/x.
  normalized = normalized.replace(/^\/\/[?.]\/(?=[a-zA-Z]:\/)/, '')
  // MSYS (Git Bash) form: /d/Projects means d:/Projects.
  normalized = normalized.replace(/^\/([a-zA-Z])(?=\/|$)/, '$1:')
  if (/^[a-zA-Z]:\//.test(normalized)) {
    normalized = normalized.charAt(0).toLowerCase() + normalized.slice(1)
  }
  return posix.normalize(normalized)
}

const isWindowsPath = (path: string) => /^[a-z]:\//.test(path)

/**
 * The project-relative form of `filePath` with forward slashes, or null when
 * the path is outside the project. Windows paths compare case-insensitively.
 */
export function toRepoRelative(filePath: string, projectDir: string): string | null {
  const root = normalize(projectDir).replace(/\/$/, '')
  let file = normalize(filePath)
  if (!file.startsWith('/') && !isWindowsPath(file)) file = posix.normalize(`${root}/${file}`)
  const fold = isWindowsPath(root) ? (path: string) => path.toLowerCase() : (path: string) => path
  if (fold(file) === fold(root)) return ''
  if (!fold(file).startsWith(`${fold(root)}/`)) return null
  return file.slice(root.length + 1)
}

function generatedDirOf(relativePath: string, caseInsensitive: boolean): string | undefined {
  const first = relativePath.split('/')[0] ?? ''
  return GENERATED_DIRS.find((dir) => (caseInsensitive ? first.toLowerCase() : first) === dir)
}

/** The texts that name files for a given tool: paths, globs or a command line. */
function inspectedTexts(tool: string, toolInput: Record<string, unknown> | undefined): string[] {
  const fields = FILE_TOOLS.has(tool)
    ? ['file_path', 'notebook_path']
    : SEARCH_TOOLS.has(tool)
      ? ['path', 'glob', ...(tool === 'Glob' ? ['pattern'] : [])]
      : SHELL_TOOLS.has(tool)
        ? ['command']
        : []
  return fields.flatMap((field) => stringField(toolInput, field) ?? [])
}

/** PreToolUse policy: no `.env*` access, no hand-written files in generated dirs. */
export function checkToolUse(input: HookInput, projectDir: string): Decision {
  const tool = input.tool_name ?? ''

  const envFiles = inspectedTexts(tool, input.tool_input).flatMap(referencedEnvFiles)
  if (envFiles.length > 0) {
    return {
      allowed: false,
      reason:
        `guard-paths: blocked ${tool}, it refers to ${[...new Set(envFiles)].join(', ')}. ` +
        '.env* files hold secrets: Claude never reads, prints or edits them (CLAUDE.md, Never). ' +
        'Document variables in .env.example; code loads .env itself.',
    }
  }

  if (WRITE_TOOLS.has(tool)) {
    const target =
      stringField(input.tool_input, 'file_path') ?? stringField(input.tool_input, 'notebook_path')
    const relativePath = target === undefined ? null : toRepoRelative(target, projectDir)
    const dir =
      relativePath === null
        ? undefined
        : generatedDirOf(relativePath, isWindowsPath(normalize(projectDir)))
    if (dir !== undefined && relativePath !== null) {
      return {
        allowed: false,
        reason:
          `guard-paths: blocked ${tool} on ${relativePath}. ${dir}/ is generated and never written by hand ` +
          '(CLAUDE.md, Never). Change the code that generates it instead.',
      }
    }
  }

  return { allowed: true }
}
