// Compiler questions (ADR-0018): from each compiled example, with no call to any model. Its answer
// is what the compiler said of the example at ingest (ADR-0017), so no eval tests them.
import type { BankQuestion, CompilerAnswer } from '@docs-rag-lab/contracts'
import { compiledExamples, sha256Hex, type Source } from '@docs-rag-lab/source-kit'

import type { BankChunk, BankDocument } from './documents.ts'
import { sectionCitation } from './sections.ts'
import { withoutEmDash } from './text.ts'

/** A question as the bank stores it, with the text of the chunk it was made from. */
export interface MadeQuestion {
  question: BankQuestion
  textHash: string
}

export const ERROR_PROMPT =
  'Does this code compile? If not, which errors does TypeScript report, and on which lines?'

/**
 * A markdown code span: code that holds a backtick, such as a template literal type, gets a longer
 * run of them, padded with a space, so that a reader of the markdown finds where it ends.
 */
export function codeSpan(code: string): string {
  const longest = Math.max(0, ...(code.match(/`+/g) ?? []).map((run) => run.length))
  if (longest === 0) return `\`${code}\``
  const fence = '`'.repeat(longest + 1)
  return `${fence} ${code} ${fence}`
}

export const typePrompt = (target: string, line: string): string =>
  `What type does TypeScript show for ${codeSpan(target)} on the line ${codeSpan(line.trim())}?`

const visibleIn = (code: string, line: string): boolean =>
  code.split('\n').some((shown) => shown.trim() === line.trim())

const errorAnswer = (errors: CompilerAnswer['errors']): string =>
  [
    'It does not compile. TypeScript reports:',
    ...errors.map(
      ({ code, line, text }) =>
        // The compiler's own lines, indented under the error, as the site shows them.
        `- TS${String(code)} on ${codeSpan(line.trim())}: ${text.replaceAll('\n', '\n  ')}`,
    ),
  ].join('\n')

/** Every compiler question of a document's chunks, in chunk order. */
export function compilerQuestions(
  source: Source,
  document: BankDocument,
  compiler: string,
): MadeQuestion[] {
  return document.chunks.flatMap((chunk) => chunkQuestions(source, document, chunk, compiler))
}

function chunkQuestions(
  source: Source,
  document: BankDocument,
  chunk: BankChunk,
  compiler: string,
): MadeQuestion[] {
  if (chunk.compiler.length === 0) return []
  const idOf = (kind: string, example: number, item: number): string =>
    sha256Hex([chunk.id, chunk.textHash, kind, String(example), String(item)].join('\n')).slice(
      0,
      16,
    )

  return compiledExamples(chunk.text, chunk.compiler).flatMap((example, e) => {
    // The section the example is in, which need not be the one the chunk starts in.
    const { url, sectionPath } = sectionCitation(document, chunk, example.start)
    const citation = {
      url,
      title: document.title,
      sectionPath,
      docPath: document.path,
      chunkId: chunk.id,
    }
    const displayed = source.displayCode?.(example.code) ?? { code: example.code, setup: '' }
    const shown = displayed.code
    const code = {
      lang: example.lang,
      code: shown,
      ...(displayed.setup === '' ? {} : { setup: displayed.setup }),
      compiled: true,
    }
    const made: MadeQuestion[] = []
    const { errors, queries } = example.output
    // An error on a line the docs do not show cannot be asked about.
    if (errors.length > 0 && errors.every(({ line }) => visibleIn(shown, line))) {
      made.push({
        textHash: chunk.textHash,
        question: {
          id: idOf('compiler-error', e, 0),
          source: source.id,
          kind: 'compiler-error',
          topicId: document.topic.id,
          prompt: ERROR_PROMPT,
          code,
          answer: withoutEmDash(errorAnswer(errors)),
          compiler: { compiler, errors, queries: [] },
          citation,
          verifiedBy: 'compiler',
        },
      })
    }
    queries.forEach((query, q) => {
      if (!visibleIn(shown, query.line)) return
      made.push({
        textHash: chunk.textHash,
        question: {
          id: idOf('compiler-type', e, q),
          source: source.id,
          kind: 'compiler-type',
          topicId: document.topic.id,
          prompt: withoutEmDash(typePrompt(query.target, query.line)),
          code,
          answer: withoutEmDash(query.text),
          compiler: { compiler, errors: [], queries: [query] },
          citation,
          verifiedBy: 'compiler',
        },
      })
    })
    return made
  })
}
