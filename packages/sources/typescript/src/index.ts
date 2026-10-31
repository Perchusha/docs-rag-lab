// Public entry of @docs-rag-lab/source-typescript: the TypeScript-Website
// source (SPEC section 8). Docs content is CC BY 4.0, code is MIT.
import type { Block, ParsedDoc, Source, SourceFile } from '@docs-rag-lab/source-kit'

import { parseMarkdown } from './markdown.ts'
import { docTypeOf, INCLUDES, isOption, matchPath, optionOf, permalinkUrl } from './paths.ts'

export { INCLUDES, matchPath } from './paths.ts'

export interface TypescriptSourceOptions {
  branch?: string
}

/** Error codes named by `// @errors:` twoslash directives, sorted. */
export function errorCodesOf(code: readonly string[]): number[] {
  const codes = new Set<number>()
  for (const block of code) {
    // Codes on the directive's own line only: [\d \t,], not \s, which would run into the next line.
    for (const match of block.matchAll(/^[ \t]*\/\/[ \t]*@errors:[ \t]*([\d \t,]+)$/gm)) {
      for (const value of (match[1] ?? '').split(/[\s,]+/)) {
        if (value !== '') codes.add(Number(value))
      }
    }
  }
  return [...codes].sort((a, b) => a - b)
}

function stringOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

async function parseFile(file: SourceFile): Promise<ParsedDoc> {
  const option = isOption(file.path)
  const markdown = parseMarkdown(file.content, { anchors: !option })
  const { frontmatter } = markdown
  const oneline = stringOf(frontmatter.oneline)
  const metadata: Record<string, unknown> = {}
  if (oneline !== undefined) metadata.oneline = oneline
  const errorCodes = errorCodesOf(markdown.code)
  if (errorCodes.length > 0) metadata.error_codes = errorCodes

  let title: string
  let url: string
  let sections = markdown.sections
  if (option) {
    const { name, url: optionUrl } = optionOf(file.path)
    title = `TSConfig Option: ${name}`
    url = optionUrl
    metadata.option = name
    const display = stringOf(frontmatter.display)
    if (display !== undefined) metadata.display = display
    // The one-line summary is the option's definition on the site; keep it as text.
    if (oneline !== undefined) {
      const summary: Block = { kind: 'prose', text: oneline }
      const [first, ...rest] = sections
      sections =
        first?.headingPath.length === 0
          ? [{ ...first, blocks: [summary, ...first.blocks] }, ...rest]
          : [{ headingPath: [], anchor: '', blocks: [summary] }, ...sections]
    }
  } else {
    const docTitle = stringOf(frontmatter.title)
    if (docTitle === undefined) throw new Error(`${file.path}: frontmatter has no title`)
    title = docTitle
    url = permalinkUrl(file.path, frontmatter.permalink)
    const version = /^TypeScript (\d+\.\d+)\b/.exec(title)?.[1]
    if (docTypeOf(file.path) === 'release-notes' && version !== undefined) {
      metadata.version_introduced = version
    }
  }

  return Promise.resolve({ title, url, docType: docTypeOf(file.path), sections, metadata })
}

export function typescriptSource(options: TypescriptSourceOptions = {}): Source {
  return {
    id: 'typescript',
    repo: 'https://github.com/microsoft/TypeScript-Website',
    branch: options.branch ?? 'v2',
    include: INCLUDES.map((include) => include.dir),
    license: {
      name: 'CC BY 4.0 (documentation), MIT (code)',
      url: 'https://creativecommons.org/licenses/by/4.0/',
      attribution: 'TypeScript documentation, Copyright (c) Microsoft Corporation.',
    },
    match: matchPath,
    parse: parseFile,
  }
}
