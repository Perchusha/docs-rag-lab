// The control for contextual retrieval (ADR-0014): the same pipeline, with a prefix written by
// code from the chunk's own headings instead of a context from Claude. The chunk text already
// holds these headings, so this adds no new word: it shows what saying them twice does.
import type { IndexVariant } from '../indexes.ts'
import type { ContextDocument } from './generate.ts'

/** What a manifest and a report's identity say wrote the prefixes. */
export const CONTROL_IDENTITY = 'heading-prefix:1'

/** Which index a report's identity says it measured. */
export function variantOfContextModel(contextModel: string | null): IndexVariant | undefined {
  if (contextModel === null) return undefined
  return contextModel === CONTROL_IDENTITY ? 'control' : 'contextual'
}

export function headingPrefix(title: string, sectionPath: readonly string[]): string {
  return [title, ...sectionPath].join(' > ')
}

/** Each chunk's prefix, by chunk ID. */
export function controlContexts(documents: readonly ContextDocument[]): Map<string, string> {
  return new Map(
    documents.flatMap(({ title, chunks }) =>
      chunks.map(({ id, sectionPath }) => [id, headingPrefix(title, sectionPath)]),
    ),
  )
}
