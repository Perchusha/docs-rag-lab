// The twoslash compile of the docs' examples (ADR-0017). Each example fenced as twoslash is run
// through the compiler the docs pin, `typescript` 6.0.2, and what it said goes on the code block:
// its errors, its type queries and the file it emits when the example asks to show one. The code
// itself stays as written. An example that does not compile gets nothing, and the reason.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { CompilerOutput } from '@docs-rag-lab/source-kit'
import { createTwoslasher, type CreateTwoslashOptions, type TwoslashInstance } from 'twoslash'

const require = createRequire(import.meta.url)

/** The compiler the docs pin at the indexed commit, in their root package.json. */
const ts = require('typescript-docs') as typeof import('typescript-docs')
/** This package's directory, with no trailing slash, which twoslash would double in its paths. */
const PACKAGE_DIR = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const TWOSLASH_VERSION = (
  JSON.parse(
    readFileSync(join(PACKAGE_DIR, 'node_modules', 'twoslash', 'package.json'), 'utf8'),
  ) as {
    version: string
  }
).version

/** What the compiled index's manifest names (ADR-0017). */
export const COMPILER = `twoslash ${TWOSLASH_VERSION}, typescript ${ts.version}`

/** An example fenced as twoslash: `ts twoslash`, `tsx twoslash {1}` and the like. */
export function isTwoslash(meta: string | null | undefined): boolean {
  return meta !== null && meta !== undefined && /(^|\s)twoslash(\s|$)/.test(meta)
}

/** The extension twoslash reads an example as, from its fence's language. */
function extensionOf(lang: string): string {
  return ['ts', 'tsx', 'js', 'jsx'].includes(lang) ? lang : 'ts'
}

/** The named error codes of an example: the lines `// @errors: 2345 2322`. */
function namedErrors(code: string): number[] {
  const named = new Set<number>()
  for (const match of code.matchAll(/^[ \t]*\/\/[ \t]*@errors:[ \t]*([\d \t,]+)$/gm)) {
    for (const value of (match[1] ?? '').split(/[\s,]+/)) if (value !== '') named.add(Number(value))
  }
  return [...named]
}

/** The first line of a compiler's complaint, with its whitespace collapsed. */
function reasonOf(error: unknown): string {
  if (error instanceof Error) {
    const { title } = error as Error & { title?: unknown }
    const description = (error as Error & { description?: unknown }).description
    const head = typeof title === 'string' && title !== '' ? title : error.message
    const detail = typeof description === 'string' ? description.split('\n')[0] : ''
    return `${head}${detail === undefined || detail === '' ? '' : `: ${detail}`}`
      .replace(/\s+/g, ' ')
      .trim()
  }
  return String(error).replace(/\s+/g, ' ').trim()
}

export type CompileOutcome = { ok: true; output: CompilerOutput } | { ok: false; reason: string }

export interface DocsCompiler {
  compile(code: string, lang: string): CompileOutcome
}

/**
 * A compiler for the docs' examples. It reads only the compiler's own library files and the
 * packages this source installs, so the same example compiles the same way on any machine.
 */
export function createDocsCompiler(): DocsCompiler {
  const twoslasher: TwoslashInstance = createTwoslasher({
    // twoslash types its module by the typescript it resolves itself, which has the same API.
    tsModule: ts as unknown as NonNullable<CreateTwoslashOptions['tsModule']>,
    tsLibDirectory: dirname(require.resolve('typescript-docs/lib/lib.d.ts')),
    // Imports in an example resolve from this package.
    vfsRoot: PACKAGE_DIR,
    fsCache: false,
  })
  return {
    compile(code, lang) {
      try {
        const result = twoslasher(code, extensionOf(lang))
        // twoslash fails an error the example did not name; one it names and that is not raised
        // fails here, so that every named error is one the compiler gives (ADR-0017).
        const raised = new Set(result.errors.map((error) => error.code))
        const missing = namedErrors(code).filter((named) => !raised.has(named))
        if (missing.length > 0) {
          return {
            ok: false,
            reason: `Expected errors were not raised: ${missing.sort((a, b) => a - b).join(', ')}`,
          }
        }
        const lines = result.code.split('\n')
        const lineAt = (line: number): string => lines[line] ?? ''
        const { handbookOptions } = result.meta
        const shown = handbookOptions.showEmit || handbookOptions.showEmittedFile !== undefined
        return {
          ok: true,
          output: {
            errors: result.errors.map((error) => ({
              code: typeof error.code === 'number' ? error.code : Number(error.code),
              line: lineAt(error.line),
              text: error.text,
            })),
            queries: result.queries.map((query) => ({
              target: query.target,
              line: lineAt(query.line),
              text: query.text,
            })),
            ...(shown
              ? {
                  emitted: {
                    name: handbookOptions.showEmittedFile ?? `index.${result.meta.extension}`,
                    lang: result.meta.extension,
                    code: result.code.replace(/\n+$/, ''),
                  },
                }
              : {}),
          },
        }
      } catch (error) {
        return { ok: false, reason: reasonOf(error) }
      }
    },
  }
}
