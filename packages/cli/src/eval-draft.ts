// What drafting a golden set takes from the docs, and from no retriever (ADR-0016): the walk
// that picks fresh questions by the docs' own dates, and the check of a draft's anchors and
// wording. Neither searches, ranks or calls a paid API. The walk needs the docs' history, which
// the sync's shallow checkout does not have, so it keeps a clone of its own under the cache.
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { openIndexes, parseGoldenSet, resolveAnchor, type AnchorRef } from '@docs-rag-lab/core'
import { git, GitError, normalizeText, type ParsedDoc, type Source } from '@docs-rag-lab/source-kit'

import { findSource, type CommandContext } from './commands.ts'
import { CliError } from './errors.ts'
import { goldenDraftPath } from './golden.ts'

/** A list this long reaches the tenth question unless most entries are skipped. A longer one starts the same. */
export const WALK_TOP = 50

/** A run of this many words shared with the docs counts as copied (ADR-0016). */
const COPIED_RUN = 4

export interface Dated {
  commit: string
  /** The commit's committer date, in ISO 8601. */
  date: string
}

export interface DocHistory {
  /** The commit that first added the page, following renames. */
  page: Dated | undefined
  /** The commit that first added each heading, by `normalizeHeading`. */
  headings: Map<string, Dated>
}

export interface WalkEntry extends Dated {
  path: string
  /** The heading's anchor, or '' for the page itself. */
  anchor: string
  /** The page's title or the heading's text. */
  title: string
  /** False for a heading the history does not show, which takes its page's date. */
  dated: boolean
}

/** A heading as the parser or a raw `##` line writes it, so that the two compare equal. */
export function normalizeHeading(text: string): string {
  return text
    .replace(/\{\/\*.*?\*\/\}/g, '')
    .replace(/\{#[^}]*\}/g, '')
    .replace(/\s#+\s*$/, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

const COMMIT_MARK = '\x01'
const ADDED_HEADING = /^\+ {0,3}#{1,6}[ \t]+(.+)$/

/**
 * Reads `git log --follow --patch` of one page, which runs newest first, so an older commit
 * overwrites a newer one and the first to add a heading stays. A rename adds no lines, so a
 * heading keeps its date through it.
 */
export function parseHistory(log: string): DocHistory {
  const headings = new Map<string, Dated>()
  let page: Dated | undefined
  for (const line of log.split('\n')) {
    if (line.startsWith(COMMIT_MARK)) {
      const [commit = '', date = ''] = line.slice(COMMIT_MARK.length).trim().split('\t')
      page = { commit, date }
      continue
    }
    const added = page === undefined ? undefined : ADDED_HEADING.exec(line.trimEnd())?.[1]
    if (added !== undefined && page !== undefined) headings.set(normalizeHeading(added), page)
  }
  return { page, headings }
}

/** A page and its headings, in document order, with the date each was first added. */
export function walkEntriesOf(path: string, doc: ParsedDoc, history: DocHistory): WalkEntry[] {
  const { page, headings } = history
  if (page === undefined) throw new CliError(`${path} has no history at this commit`)
  const entries: WalkEntry[] = [{ ...page, path, anchor: '', title: doc.title, dated: true }]
  for (const section of doc.sections) {
    const title = section.headingPath.at(-1)
    if (title === undefined) continue
    const added = headings.get(normalizeHeading(title))
    entries.push({
      ...(added ?? page),
      path,
      anchor: section.anchor,
      title,
      dated: added !== undefined,
    })
  }
  return entries
}

/** Newest first. Ties go in path order, then document order, which a stable sort keeps. */
export function orderWalk(entries: readonly WalkEntry[]): WalkEntry[] {
  return [...entries].sort((a, b) => {
    const byDate = Date.parse(b.date) - Date.parse(a.date)
    if (byDate !== 0) return byDate
    if (a.path === b.path) return 0
    return a.path < b.path ? -1 : 1
  })
}

function hasCommit(dir: string, commit: string): Promise<boolean> {
  return git(['cat-file', '-e', `${commit}^{commit}`], { cwd: dir }).then(
    () => true,
    (error: unknown) => {
      if (error instanceof GitError) return false
      throw error
    },
  )
}

/** A bare clone with the whole history of the branch and no large files, made once. */
async function ensureHistory(
  source: Pick<Source, 'repo' | 'branch'>,
  dir: string,
  commit: string,
): Promise<void> {
  if (!existsSync(join(dir, 'HEAD'))) {
    mkdirSync(dirname(dir), { recursive: true })
    await git([
      'clone',
      '--quiet',
      '--bare',
      '--single-branch',
      '--branch',
      source.branch,
      '--filter=blob:limit=1m',
      source.repo,
      dir,
    ])
  }
  if (await hasCommit(dir, commit)) return
  await git(['fetch', '--quiet', 'origin', source.branch], { cwd: dir })
  if (!(await hasCommit(dir, commit))) {
    throw new CliError(`the commit ${commit} is not on ${source.branch} of ${source.repo}`)
  }
}

function formatWalkEntry(entry: WalkEntry): string {
  const day = new Date(entry.date).toISOString().slice(0, 10)
  const place = entry.anchor === '' ? entry.path : `${entry.path}#${entry.anchor}`
  const note = entry.dated ? '' : '  (no date of its own)'
  return `${day}  ${entry.commit.slice(0, 8)}  ${place}  ${entry.title}${note}`
}

/**
 * `drl eval walk`: every indexed page and heading, newest first, at the commit the index holds
 * (ADR-0016). It takes its order from git alone: nothing here reads a question or a ranking.
 */
export async function evalWalkCommand(
  ctx: CommandContext,
  args: { source: string; top: number },
): Promise<void> {
  const { out, root } = ctx
  const source = findSource(ctx.sources, args.source)
  const indexes = openIndexes(join(root, ctx.settings.dataDir), source.id, { create: false })
  try {
    const commit = indexes.index.getManifest()?.commitSha
    if (commit === undefined) throw new CliError(`${source.id} has no index: run drl sync first`)
    const dir = join(root, ctx.settings.cacheDir, 'history', source.id)
    await ensureHistory(source, dir, commit)

    const entries: WalkEntry[] = []
    const paths = indexes.index.documentPaths()
    for (const path of paths) {
      const content = normalizeText(await git(['show', `${commit}:${path}`], { cwd: dir }))
      const doc = await source.parse({ path, content }, { commitSha: commit })
      const log = await git(
        [
          'log',
          '--follow',
          `--format=${COMMIT_MARK}%H%x09%cI`,
          '--patch',
          '--unified=0',
          '--no-color',
          '--no-ext-diff',
          commit,
          '--',
          path,
        ],
        { cwd: dir },
      )
      entries.push(...walkEntriesOf(path, doc, parseHistory(log)))
    }

    const undated = entries.filter(({ dated }) => !dated).length
    const headings = entries.length - paths.length
    out.write(
      `The walk of ${source.id} at ${commit.slice(0, 8)}: ${String(paths.length)} pages and ${String(headings)} headings, newest first.\n`,
    )
    if (undated > 0) {
      out.write(
        `${String(undated)} headings do not show in the history, and take their page's date.\n`,
      )
    }
    out.write('\n')
    for (const entry of orderWalk(entries).slice(0, args.top)) {
      out.write(`${formatWalkEntry(entry)}\n`)
    }
  } finally {
    indexes.close()
  }
}

function wordsOf(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}_$]+/gu) ?? []
}

/** The longest run of consecutive words that two lists share, the first of equal length. */
export function longestSharedRun(a: readonly string[], b: readonly string[]): string[] {
  let best = { end: 0, length: 0 }
  let previous = new Array<number>(b.length + 1).fill(0)
  for (let i = 1; i <= a.length; i++) {
    const current = new Array<number>(b.length + 1).fill(0)
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] !== b[j - 1]) continue
      const length = (previous[j - 1] ?? 0) + 1
      current[j] = length
      if (length > best.length) best = { end: i, length }
    }
    previous = current
  }
  return a.slice(best.end - best.length, best.end)
}

/**
 * Whether a heading is one word that only names a thing: `useState`, `<Suspense>`, or `memo`,
 * since a parsed heading has lost its backticks and docs capitalize a heading in words. A question
 * cannot avoid such a name, so it counts as no copy (ADR-0016). `Caveats` can be avoided.
 */
function isIdentifier(heading: string): boolean {
  const trimmed = heading.trim()
  return wordsOf(trimmed).length === 1 && !/^\p{Lu}\p{Ll}+$/u.test(trimmed)
}

export interface CopiedWording {
  kind: 'whole heading' | 'heading' | 'passage'
  words: string
}

/**
 * What a question shares with the docs it is anchored to: a run of 4 or more words with a heading
 * or a passage, or a whole heading, unless that heading is a single identifier (ADR-0016). A hit
 * only sends the question to the owner's review, so this errs towards finding too many.
 */
export function copiedWording(
  question: string,
  docs: { headings: readonly string[]; passages: readonly string[] },
): CopiedWording[] {
  const words = wordsOf(question)
  const hits = new Map<string, CopiedWording>()
  const add = (kind: CopiedWording['kind'], run: readonly string[]): void => {
    const hit = { kind, words: run.join(' ') }
    hits.set(`${kind} ${hit.words}`, hit)
  }
  for (const heading of docs.headings) {
    const headingWords = wordsOf(heading)
    const run = longestSharedRun(words, headingWords)
    if (headingWords.length > 0 && run.length === headingWords.length) {
      if (!isIdentifier(heading)) add('whole heading', run)
    } else if (run.length >= COPIED_RUN) {
      add('heading', run)
    }
  }
  for (const passage of docs.passages) {
    const run = longestSharedRun(words, wordsOf(passage))
    if (run.length >= COPIED_RUN) add('passage', run)
  }
  return [...hits.values()].sort((a, b) => b.words.length - a.words.length)
}

/** A page's title and every heading in its chunks, packed ones too. A `#` in code only adds a hit. */
function headingsOf(document: {
  title: string
  chunks: readonly { headingPath: readonly string[]; text: string }[]
}): string[] {
  const headings = new Set([document.title])
  for (const chunk of document.chunks) {
    for (const heading of chunk.headingPath) headings.add(heading)
    for (const line of chunk.text.split('\n')) {
      const heading = /^#{1,6} +(.+)$/.exec(line)?.[1]
      if (heading !== undefined) headings.add(heading)
    }
  }
  return [...headings]
}

/**
 * `drl eval check --draft`: a draft against the index, before any review. It says which anchors
 * do not resolve, and what each question copies from the docs. It looks at no ranking.
 */
export function evalDraftCheckCommand(ctx: CommandContext, args: { source: string }): void {
  const { out, root } = ctx
  const source = findSource(ctx.sources, args.source)
  const path = goldenDraftPath(root, source.id)
  if (!existsSync(path)) throw new CliError(`${source.id} has no draft: ${path} does not exist`)
  const questions = parseGoldenSet(readFileSync(path, 'utf8'))

  const indexes = openIndexes(join(root, ctx.settings.dataDir), source.id, { create: false })
  try {
    const { index } = indexes
    const unresolved: string[] = []
    const copied: string[] = []
    for (const question of questions) {
      const headings: string[] = []
      const passages: string[] = []
      const refs: AnchorRef[] = [...question.primary, ...question.acceptable]
      for (const ref of refs) {
        const resolved = resolveAnchor(ref, index)
        if (resolved.problem !== undefined) {
          unresolved.push(`${question.id}: ${ref.at} does not resolve (${resolved.problem})`)
          continue
        }
        const document = index.documentChunks(ref.at.split('#')[0] ?? '')
        if (document === undefined) continue
        headings.push(...headingsOf(document))
        const ids = new Set(resolved.chunks.map(({ chunkId }) => chunkId))
        passages.push(
          ...document.chunks.filter(({ chunkId }) => ids.has(chunkId)).map(({ text }) => text),
        )
      }
      for (const { kind, words } of copiedWording(question.question, { headings, passages })) {
        copied.push(`${question.id}: copies a ${kind}: "${words}"`)
      }
    }

    const tags = new Map<string, number>()
    for (const tag of questions.flatMap((question) => question.tags)) {
      tags.set(tag, (tags.get(tag) ?? 0) + 1)
    }
    const counted = [...tags]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([tag, n]) => `${tag} ${String(n)}`)
    out.write(`${String(questions.length)} questions: ${counted.join(', ')}\n`)
    out.write(copied.length === 0 ? 'No copied wording.\n' : `\n${copied.join('\n')}\n`)
    if (unresolved.length > 0) {
      throw new CliError(`anchors that do not resolve:\n${unresolved.join('\n')}`)
    }
  } finally {
    indexes.close()
  }
}
