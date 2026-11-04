// The generated contexts, committed: eval/contexts/<source>/<docs sha>.jsonl (ADR-0014). They
// cannot be made again, since Claude would write other text, so they are kept with the model
// and the hash of the prompt that wrote them, and a sync reads them before it calls anything.
// A header line, then one line per chunk, in chunk ID order once a run is done.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface ContextsHeader {
  version: 1
  model: string
  promptHash: string
  docsCommit: string
}

export interface StoredContext {
  chunkId: string
  /** The text this context was written for. A chunk whose text changed needs a new one. */
  textHash: string
  context: string
}

export function contextsPath(root: string, sourceId: string, docsCommit: string): string {
  return join(root, 'eval', 'contexts', sourceId, `${docsCommit}.jsonl`)
}

function parseEntry(line: string, where: string): StoredContext {
  const { chunkId, textHash, context } = JSON.parse(line) as Partial<StoredContext>
  if (typeof chunkId !== 'string' || typeof textHash !== 'string' || typeof context !== 'string') {
    throw new Error(`${where}: a context needs chunkId, textHash and context`)
  }
  return { chunkId, textHash, context }
}

/**
 * What the file holds for this model, prompt and commit, by chunk ID. A file from another model
 * or prompt holds nothing that can be reused, and neither does no file at all.
 */
export function readContexts(path: string, expected: ContextsHeader): Map<string, StoredContext> {
  if (!existsSync(path)) return new Map()
  const [first, ...rows] = readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
  if (first === undefined) return new Map()
  const { model, promptHash, docsCommit } = JSON.parse(first) as Partial<ContextsHeader>
  if (
    model !== expected.model ||
    promptHash !== expected.promptHash ||
    docsCommit !== expected.docsCommit
  ) {
    return new Map()
  }
  return new Map(
    rows.map((line, i) => {
      const entry = parseEntry(line, `${path}:${String(i + 2)}`)
      return [entry.chunkId, entry]
    }),
  )
}

/** The whole file, in chunk ID order, so that it reads the same however it was made. */
export function writeContexts(
  path: string,
  header: ContextsHeader,
  entries: Iterable<StoredContext>,
): void {
  const sorted = [...entries].sort((a, b) => (a.chunkId < b.chunkId ? -1 : 1))
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, [header, ...sorted].map((row) => `${JSON.stringify(row)}\n`).join(''))
}

/** One more line, as soon as it was paid for, so that a run that stops keeps what it got. */
export function appendContext(path: string, entry: StoredContext): void {
  appendFileSync(path, `${JSON.stringify(entry)}\n`)
}
