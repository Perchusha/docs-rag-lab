// Public entry of @docs-rag-lab/source-react: its plugin (SPEC section 7).
import type { ParsedDoc, Source, SourceFile } from '@docs-rag-lab/source-kit'

import { INCLUDES, matchPath } from './paths.ts'

export { INCLUDES, matchPath } from './paths.ts'

export interface ReactSourceOptions {
  branch?: string
}

/**
 * Bump when parsing the same file gives different output: the next sync then
 * re-parses everything (the embedding cache keeps it free).
 */
export const PARSER_VERSION = 1

/** The scaffold stops here: the parser is written against the fixtures. */
async function parseFile(file: SourceFile): Promise<ParsedDoc> {
  return Promise.reject(new Error(`${file.path}: the react parser is not written yet`))
}

export function reactSource(options: ReactSourceOptions = {}): Source {
  return {
    id: 'react',
    repo: 'https://github.com/reactjs/react.dev',
    branch: options.branch ?? 'main',
    include: INCLUDES.map((include) => include.dir),
    license: {
      name: 'CC BY 4.0',
      url: 'https://creativecommons.org/licenses/by/4.0/',
      attribution: 'React documentation, Copyright (c) Meta Platforms, Inc. and affiliates.',
    },
    parserVersion: PARSER_VERSION,
    match: matchPath,
    parse: parseFile,
  }
}
