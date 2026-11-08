// What the interview-prep app needs from this source (ADR-0018): where each document sits in the
// topic map, and an example's code as the docs site shows it. The bank covers the Handbook, the
// Reference and the compiler options, and leaves out the release notes and the other docs.
import type { DisplayedCode, InterviewDocument, InterviewTopic } from '@docs-rag-lab/source-kit'

const DOCS = 'packages/documentation/copy/en/'

/** Each Handbook and Reference page is a topic, and the compiler options are one together. */
export function interviewTopicOf(document: InterviewDocument): InterviewTopic | undefined {
  switch (document.docType) {
    case 'handbook':
    case 'reference': {
      const id = document.path.replace(DOCS, '').replace(/\.md$/, '')
      const group = document.docType === 'handbook' ? 'Handbook' : 'Reference'
      return { id, title: document.title, group }
    }
    case 'option':
      return { id: 'compiler-options', title: 'Compiler options', group: 'Compiler options' }
    default:
      return undefined
  }
}

// `// @errors: 2345`, `// @noErrors`, `// @strict: false`. A file name stays: it is part of what
// the example shows. `// @ts-expect-error` is code, and does not match: its name runs into a hyphen.
const DIRECTIVE = /^\s*\/\/\s*@(\w+)(?::.*)?\s*$/
// `// ^?` type queries, `// ^|` completions and `// ^^^` highlights.
const QUERY = /^\s*\/\/\s*\^/
const CUT = /^\s*\/\/\s*---cut(?:-before)?---\s*$/
const CUT_AFTER = /^\s*\/\/\s*---cut-after---\s*$/
const CUT_START = /^\s*\/\/\s*---cut-start---\s*$/
const CUT_END = /^\s*\/\/\s*---cut-end---\s*$/

const trimBlankLines = (lines: readonly string[]): string[] => {
  let start = 0
  let end = lines.length
  while (start < end && (lines[start] ?? '').trim() === '') start++
  while (end > start && (lines[end - 1] ?? '').trim() === '') end--
  return lines.slice(start, end)
}

/** A line a reader of the example sees: no directive but a file name, and no type query. */
function isCode(line: string): boolean {
  if (QUERY.test(line)) return false
  const directive = DIRECTIVE.exec(line)
  return directive === null || directive[1] === 'filename'
}

/**
 * A twoslash example as the site shows it: without the directives that would give an answer
 * away, without its type query lines, and with only what the cut markers leave visible. What
 * they hide, such as the declarations the visible code uses, is the setup, in order and with the
 * same lines taken out, so that a question can show it on demand.
 */
export function displayCode(code: string): DisplayedCode {
  const lines = code.split('\n')
  const lastCut = lines.findLastIndex((line) => CUT.test(line))
  const cutAfter = lines.findIndex((line, i) => i > lastCut && CUT_AFTER.test(line))
  const shown: string[] = []
  const setup: string[] = []
  let hidden = false
  lines.forEach((line, i) => {
    if (i === lastCut || i === cutAfter) return
    if (CUT_START.test(line)) hidden = true
    else if (CUT_END.test(line)) hidden = false
    else if (!isCode(line)) return
    else if (hidden || i < lastCut || (cutAfter !== -1 && i > cutAfter)) setup.push(line)
    else shown.push(line)
  })
  return { code: trimBlankLines(shown).join('\n'), setup: trimBlankLines(setup).join('\n') }
}
