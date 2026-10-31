import { describe, expect, it } from 'vitest'

import { checkToolUse, referencedEnvFiles, toRepoRelative } from './guard.ts'

const WIN_ROOT = 'D:\\Projects\\docs-rag-lab'
const POSIX_ROOT = '/home/dev/docs-rag-lab'

const bash = (command: string) => ({ tool_name: 'Bash', tool_input: { command } })
const read = (file_path: string) => ({ tool_name: 'Read', tool_input: { file_path } })
const write = (file_path: string) => ({
  tool_name: 'Write',
  tool_input: { file_path, content: 'x' },
})

describe('referencedEnvFiles: .env is matched as a file name, not a substring', () => {
  it.each([
    ['process.env', 'process.env.ANTHROPIC_API_KEY'],
    ['import.meta.env', 'const key = import.meta.env.VITE_KEY'],
    ['.env.example', '.env.example'],
    ['.env.example in a command', 'git add .env.example && cat "./.env.example"'],
    ['PowerShell $env:', '$env:CLAUDE_PROJECT_DIR'],
    ['a dotenv package name', 'pnpm add dotenv'],
    ['a file ending in .env', 'config/production.env'],
  ])('allows %s', (_label, text) => {
    expect(referencedEnvFiles(text)).toEqual([])
  })

  it.each([
    ['.env', '.env', ['.env']],
    ['./.env.local', './.env.local', ['.env.local']],
    ['cat .env', 'cat .env', ['.env']],
    ['node --env-file=.env', 'node --env-file=.env x.js', ['.env']],
    ['a quoted name', 'type ".env.production"', ['.env.production']],
    ['a Windows path', 'C:\\repo\\.env', ['.env']],
    ['.envrc (covered by the .env* glob)', 'source .envrc', ['.envrc']],
    ['a copy of the example', 'cat .env.example.bak', ['.env.example.bak']],
    // Found in the M0 review: NTFS is case-insensitive, and shells have more separators.
    ['upper case (NTFS opens it as .env)', 'C:\\repo\\.ENV', ['.ENV']],
    ['mixed case', 'Get-Content .Env', ['.Env']],
    ['a comma-separated list', 'Get-Content README.md,.env', ['.env']],
    ['a PowerShell parameter with a colon', 'Get-Content -Path:.env', ['.env']],
    ['input redirection', 'cat<.env', ['.env']],
    ['command substitution', 'echo "$(<.env)"', ['.env']],
    ['brace expansion', 'cat {README.md,.env}', ['.env']],
  ])('denies %s', (_label, text, expected) => {
    expect(referencedEnvFiles(text)).toEqual(expected)
  })

  it('allows the example file in any case', () => {
    expect(referencedEnvFiles('Get-Content .ENV.EXAMPLE')).toEqual([])
  })
})

describe('checkToolUse: .env* access', () => {
  it.each([
    ['Read of .env', read(`${WIN_ROOT}\\.env`)],
    ['Read of ./.env.local', read('./.env.local')],
    ['Edit of .env', { tool_name: 'Edit', tool_input: { file_path: `${POSIX_ROOT}/.env` } }],
    ['Bash cat .env', bash('cat .env')],
    ['Bash node --env-file=.env', bash('node --env-file=.env packages/cli/src/index.ts')],
    [
      'PowerShell Get-Content',
      { tool_name: 'PowerShell', tool_input: { command: 'Get-Content .env' } },
    ],
    ['Glob for .env*', { tool_name: 'Glob', tool_input: { pattern: '**/.env*' } }],
    ['Grep inside .env', { tool_name: 'Grep', tool_input: { pattern: 'KEY', path: '.env' } }],
  ])('denies %s', (_label, input) => {
    const decision = checkToolUse(input, WIN_ROOT)

    expect(decision.allowed).toBe(false)
    expect(decision.allowed ? '' : decision.reason).toMatch(/\.env/)
  })

  it.each([
    ['Read of .env.example', read(`${WIN_ROOT}\\.env.example`)],
    [
      'Edit of .env.example',
      { tool_name: 'Edit', tool_input: { file_path: `${WIN_ROOT}\\.env.example` } },
    ],
    ['Read of a file named env.ts', read(`${WIN_ROOT}\\packages\\core\\src\\env.ts`)],
    ['Bash using process.env', bash('node -e "console.log(Object.keys(process.env).length)"')],
    [
      'Grep for the text .env in code',
      { tool_name: 'Grep', tool_input: { pattern: '\\.env', path: 'packages' } },
    ],
    [
      'an unrelated tool',
      { tool_name: 'WebFetch', tool_input: { url: 'https://example.com/.env' } },
    ],
  ])('allows %s', (_label, input) => {
    expect(checkToolUse(input, WIN_ROOT)).toEqual({ allowed: true })
  })
})

describe('checkToolUse: generated directories', () => {
  it.each([
    ['Write to data/ (Windows)', write(`${WIN_ROOT}\\data\\sources\\typescript.sqlite`), WIN_ROOT],
    [
      'Write to .cache/ (Windows)',
      write(`${WIN_ROOT}\\.cache\\sources\\typescript\\README.md`),
      WIN_ROOT,
    ],
    ['Write to data/ (POSIX)', write(`${POSIX_ROOT}/data/cache.sqlite`), POSIX_ROOT],
    [
      'Write with a lower-case drive letter',
      write('d:\\Projects\\docs-rag-lab\\data\\x.txt'),
      WIN_ROOT,
    ],
    ['Write with different case on Windows', write(`${WIN_ROOT}\\Data\\x.txt`), WIN_ROOT],
    ['Write through ..', write(`${WIN_ROOT}\\packages\\..\\data\\x.txt`), WIN_ROOT],
    ['Write with an MSYS path', write('/d/Projects/docs-rag-lab/data/x.txt'), WIN_ROOT],
    ['Write with a Win32 namespace prefix', write(`\\\\?\\${WIN_ROOT}\\.cache\\x.txt`), WIN_ROOT],
    [
      'Edit in .cache/',
      { tool_name: 'Edit', tool_input: { file_path: `${POSIX_ROOT}/.cache/x` } },
      POSIX_ROOT,
    ],
  ])('denies %s', (_label, input, root) => {
    const decision = checkToolUse(input, root)

    expect(decision.allowed).toBe(false)
    expect(decision.allowed ? '' : decision.reason).toMatch(/is generated/)
  })

  it.each([
    ['Read of data/', read(`${WIN_ROOT}\\data\\x.txt`), WIN_ROOT],
    ['Write to a nested data dir', write(`${WIN_ROOT}\\packages\\core\\src\\data\\x.ts`), WIN_ROOT],
    ['Write to a file named data.ts', write(`${POSIX_ROOT}/packages/db/src/data.ts`), POSIX_ROOT],
    ['Write outside the project', write('/tmp/data/x.txt'), POSIX_ROOT],
    ['Bash that runs the CLI', bash('pnpm drl sync typescript'), POSIX_ROOT],
  ])('allows %s', (_label, input, root) => {
    expect(checkToolUse(input, root)).toEqual({ allowed: true })
  })
})

describe('toRepoRelative', () => {
  it('maps Windows paths to forward-slash relative paths', () => {
    expect(toRepoRelative(`${WIN_ROOT}\\packages\\core\\src\\index.ts`, WIN_ROOT)).toBe(
      'packages/core/src/index.ts',
    )
  })

  it('returns null outside the project and an empty string for the root', () => {
    expect(toRepoRelative('D:\\Projects\\other\\x.ts', WIN_ROOT)).toBeNull()
    expect(toRepoRelative('/home/dev/docs-rag-lab-other/x.ts', POSIX_ROOT)).toBeNull()
    expect(toRepoRelative(POSIX_ROOT, POSIX_ROOT)).toBe('')
  })
})
