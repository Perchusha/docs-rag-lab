// Does the contextual or control index hold the plain index's chunks, each with a context
// (ADR-0014, integrity check 4)? Reports compare them, so they must differ only in the contexts
// and in what those change. No API call.
import type { SourceIndex } from '@docs-rag-lab/db'

export interface VariantIndexCheck {
  chunks: number
  contexts: number
  /** What is wrong, with at most a few examples of each. Empty when all is well. */
  problems: string[]
}

const EXAMPLES = 3

function problemOf(what: string, ids: readonly string[]): string[] {
  if (ids.length === 0) return []
  const more = ids.length > EXAMPLES ? `, and ${String(ids.length - EXAMPLES)} more` : ''
  return [`${String(ids.length)} chunks ${what}: ${ids.slice(0, EXAMPLES).join(', ')}${more}`]
}

export function checkVariantIndex(
  plain: Pick<SourceIndex, 'chunkFingerprints' | 'getManifest'>,
  other: Pick<SourceIndex, 'chunkFingerprints' | 'getManifest'>,
  name: string,
): VariantIndexCheck {
  const before = new Map(plain.chunkFingerprints().map((chunk) => [chunk.id, chunk]))
  const after = other.chunkFingerprints()
  const ids = new Set(after.map(({ id }) => id))
  const plainCommit = plain.getManifest()?.commitSha
  const commit = other.getManifest()?.commitSha
  const empty = after.filter(({ context }) => context === null || context.trim() === '')
  return {
    chunks: after.length,
    contexts: after.length - empty.length,
    problems: [
      ...(plainCommit === commit
        ? []
        : [
            `the plain index is at ${String(plainCommit)}, and the ${name} one at ${String(commit)}`,
          ]),
      ...problemOf(
        'are only in the plain index',
        [...before.keys()].filter((id) => !ids.has(id)),
      ),
      ...problemOf(
        `are only in the ${name} index`,
        after.flatMap(({ id }) => (before.has(id) ? [] : [id])),
      ),
      ...problemOf(
        'have another text',
        after.flatMap(({ id, textHash }) => {
          const stored = before.get(id)
          return stored === undefined || stored.textHash === textHash ? [] : [id]
        }),
      ),
      ...problemOf(
        'have no context',
        empty.map(({ id }) => id),
      ),
    ],
  }
}
