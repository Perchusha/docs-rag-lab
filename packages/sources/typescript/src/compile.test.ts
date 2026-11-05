// The twoslash compile (ADR-0017), on small examples written here and run locally: no network.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it, vi } from 'vitest'

// The compiler loads its library on first use, which takes seconds when other packages test too.
vi.setConfig({ testTimeout: 60_000 })

import { compilerName, createDocsCompiler, isTwoslash } from './compile.ts'

const compiler = createDocsCompiler()

const ok = (code: string, lang = 'ts') => {
  const outcome = compiler.compile(code, lang)
  if (!outcome.ok) throw new Error(`did not compile: ${outcome.reason}`)
  return outcome.output
}

describe('isTwoslash', () => {
  it('knows a twoslash fence by its meta, with or without more after it', () => {
    expect(isTwoslash('twoslash')).toBe(true)
    expect(isTwoslash('twoslash {1}')).toBe(true)
    expect(isTwoslash('twoslash {class: "do-not-do-this"}')).toBe(true)
    expect(isTwoslash(null)).toBe(false)
    expect(isTwoslash('{1}')).toBe(false)
    expect(isTwoslash('twoslasher')).toBe(false)
  })
})

describe('createDocsCompiler', () => {
  it('names the compiler the docs pin, and the twoslash this package installs', () => {
    const installed = (name: string): string =>
      (
        JSON.parse(
          readFileSync(
            fileURLToPath(new URL(`../node_modules/${name}/package.json`, import.meta.url)),
            'utf8',
          ),
        ) as { version: string }
      ).version

    expect(installed('typescript-docs')).toBe('6.0.2')
    expect(compilerName()).toBe(`twoslash ${installed('twoslash')}, typescript 6.0.2`)
  })

  it('gives each named error with its code, its message and the line of the shown code', () => {
    const output = ok(
      [
        '// @errors: 2345',
        'declare function handleRequest(url: string, method: "GET" | "POST"): void;',
        'const req = { url: "https://example.com", method: "GET" };',
        'handleRequest(req.url, req.method);',
      ].join('\n'),
    )

    expect(output.errors).toEqual([
      {
        code: 2345,
        line: 'handleRequest(req.url, req.method);',
        text: 'Argument of type \'string\' is not assignable to parameter of type \'"GET" | "POST"\'.',
      },
    ])
    expect(output.queries).toEqual([])
    expect(output.emitted).toBeUndefined()
  })

  it('gives each type query with what it points at', () => {
    expect(ok('let s = "hello";\n//  ^?\nconst t = s.length;').queries).toEqual([
      { target: 's', line: 'let s = "hello";', text: 'let s: string' },
    ])
  })

  it('gives the emitted file when the example asks to show it', () => {
    expect(ok('// @showEmit\n// @target: es5\nlet x = (a: number) => a + 1;').emitted).toEqual({
      name: 'index.js',
      lang: 'js',
      code: 'var x = function (a) { return a + 1; };\nexport {};',
    })
  })

  it("fails an example that raises an error it does not name, with the compiler's reason", () => {
    const outcome = compiler.compile('let a: number = "x";', 'ts')

    expect(outcome.ok).toBe(false)
    expect(!outcome.ok && outcome.reason).toContain('not marked as being expected: 2322')
  })

  it('fails an example that names an error the compiler does not raise', () => {
    expect(compiler.compile('// @errors: 2571\nlet b = 1;', 'ts')).toEqual({
      ok: false,
      reason: 'Expected errors were not raised: 2571',
    })
  })

  it('compiles the same example the same way twice', () => {
    const code = '// @errors: 2322\nlet a: number = "x";'

    expect(compiler.compile(code, 'ts')).toEqual(createDocsCompiler().compile(code, 'ts'))
  })
})
