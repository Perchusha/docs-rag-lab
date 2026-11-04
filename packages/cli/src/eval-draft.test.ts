// `drl eval walk` and `drl eval check --draft`, over a seeded index in the OS temp dir and a
// local git repository. No network and no API key is used.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { CHUNKER_VERSION, createEmbeddingProvider, openIndexes } from '@docs-rag-lab/core'
import { settings } from '@docs-rag-lab/settings'
import type { ParsedDoc, Source, SourceFile } from '@docs-rag-lab/source-kit'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  copiedWording,
  longestSharedRun,
  normalizeHeading,
  orderWalk,
  parseHistory,
  walkEntriesOf,
  type WalkEntry,
} from './eval-draft.ts'
import { goldenDraftPath } from './golden.ts'
import { run } from './run.ts'

describe('normalizeHeading', () => {
  it('makes a raw line and a parsed heading equal', () => {
    expect(normalizeHeading('`useState` and [more](/x) {/*use-state*/}')).toBe('usestate and more')
    expect(normalizeHeading('useState and more')).toBe('usestate and more')
    expect(normalizeHeading('Closed heading ##')).toBe('closed heading')
    expect(normalizeHeading('With an id {#an-id}')).toBe('with an id')
  })
})

describe('parseHistory', () => {
  const log = [
    '\x01new\t2026-03-01T00:00:00+00:00',
    '',
    '+++ b/a.md',
    '+## Added late',
    '+not a heading',
    '-## Removed',
    '\x01old\t2026-01-01T00:00:00+00:00',
    '',
    '+++ b/a.md',
    '+# Title',
    '+## Added early',
    '+## added LATE',
    '',
  ].join('\n')

  it('keeps the oldest commit that added each heading, and the page its oldest commit', () => {
    const { page, headings } = parseHistory(log)

    expect(page?.commit).toBe('old')
    expect(headings.get('added early')?.commit).toBe('old')
    expect(headings.get('added late')?.commit).toBe('old')
    expect(headings.has('removed')).toBe(false)
    expect(headings.has('not a heading')).toBe(false)
  })

  it('gives no page for an empty log', () => {
    expect(parseHistory('').page).toBeUndefined()
  })
})

describe('walkEntriesOf', () => {
  const doc: ParsedDoc = {
    title: 'A page',
    url: 'https://x.dev/a',
    docType: 'handbook',
    metadata: {},
    sections: [
      { headingPath: [], anchor: '', blocks: [] },
      { headingPath: ['Old'], anchor: 'old', blocks: [] },
      { headingPath: ['Old', 'Not in the log'], anchor: 'lost', blocks: [] },
    ],
  }

  it('gives a heading the history does not show its page date, and says so', () => {
    const page = { commit: 'c1', date: '2026-01-01T00:00:00Z' }
    const entries = walkEntriesOf('a.md', doc, {
      page,
      headings: new Map([['old', { commit: 'c2', date: '2026-02-01T00:00:00Z' }]]),
    })

    expect(entries.map(({ title, commit, dated }) => [title, commit, dated])).toEqual([
      ['A page', 'c1', true],
      ['Old', 'c2', true],
      ['Not in the log', 'c1', false],
    ])
  })

  it('refuses a page with no history', () => {
    expect(() => walkEntriesOf('a.md', doc, { page: undefined, headings: new Map() })).toThrow(
      'no history',
    )
  })
})

describe('orderWalk', () => {
  const entry = (date: string, path: string, title: string): WalkEntry => ({
    commit: 'c',
    date,
    path,
    anchor: '',
    title,
    dated: true,
  })

  it('goes newest first, then by path, then in document order', () => {
    const ordered = orderWalk([
      entry('2026-01-01T00:00:00Z', 'z.md', 'oldest'),
      entry('2026-02-01T00:00:00Z', 'b.md', 'tie, later path'),
      entry('2026-02-01T00:00:00Z', 'a.md', 'tie, first in the document'),
      entry('2026-02-01T00:00:00Z', 'a.md', 'tie, second in the document'),
      entry('2026-03-01T02:00:00+03:00', 'y.md', 'one instant, in another zone'),
      entry('2026-02-28T23:00:00Z', 'x.md', 'the same instant'),
    ])

    expect(ordered.map(({ title }) => title)).toEqual([
      'the same instant',
      'one instant, in another zone',
      'tie, first in the document',
      'tie, second in the document',
      'tie, later path',
      'oldest',
    ])
  })
})

describe('longestSharedRun', () => {
  it('finds the longest consecutive run, not the most shared words', () => {
    expect(longestSharedRun(['a', 'b', 'c', 'x', 'd'], ['d', 'a', 'b', 'c', 'y'])).toEqual([
      'a',
      'b',
      'c',
    ])
    expect(longestSharedRun(['a'], ['b'])).toEqual([])
    expect(longestSharedRun([], [])).toEqual([])
  })
})

describe('copiedWording', () => {
  const none = { headings: [], passages: [] }

  it('counts a run of four words from the passage, whatever its case, and not three', () => {
    const passages = ['You should call the Hook at the top of your component.']

    expect(copiedWording('Where do I CALL THE HOOK at render?', { ...none, passages })).toEqual([
      { kind: 'passage', words: 'call the hook at' },
    ])
    expect(copiedWording('Where do I call the Hook?', { ...none, passages })).toEqual([])
  })

  it('counts a run of four words from a heading, and a whole heading however short', () => {
    const headings = ['Passing a function to the updater', 'Error boundaries']

    expect(copiedWording('Is passing a function to it fine?', { ...none, headings })).toEqual([
      { kind: 'heading', words: 'passing a function to' },
    ])
    expect(copiedWording('What do error boundaries catch?', { ...none, headings })).toEqual([
      { kind: 'whole heading', words: 'error boundaries' },
    ])
  })

  it('does not count a heading that is one identifier, but does count one plain word', () => {
    const headings = ['useState', '<Suspense>', 'react_dom', 'memo', 'Caveats']

    expect(
      copiedWording('What does useState do in Suspense with react_dom and memo?', {
        ...none,
        headings,
      }),
    ).toEqual([])
    expect(copiedWording('What are its caveats?', { ...none, headings })).toEqual([
      { kind: 'whole heading', words: 'caveats' },
    ])
  })

  it('finds nothing in a question asked in another language', () => {
    expect(
      copiedWording('Где вызывать хук в компоненте?', {
        headings: ['Calling the Hook'],
        passages: ['You should call the Hook at the top of your component.'],
      }),
    ).toEqual([])
  })

  it('reports one hit once, the longest first', () => {
    const passages = ['one two three four', 'one two three four five six']

    expect(copiedWording('one two three four five six', { ...none, passages })).toEqual([
      { kind: 'passage', words: 'one two three four five six' },
      { kind: 'passage', words: 'one two three four' },
    ])
  })
})

describe('the commands', () => {
  let root: string
  let repo: string

  function capture() {
    let text = ''
    return {
      writer: {
        write: (chunk: string) => {
          text += chunk
          return true
        },
      },
      text: () => text,
    }
  }

  function gitIn(...args: string[]): string {
    return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
  }

  function commitAt(date: string, message: string): string {
    gitIn('add', '-A')
    execFileSync('git', ['commit', '-q', '-m', message], {
      cwd: repo,
      env: { ...process.env, GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date },
    })
    return gitIn('rev-parse', 'HEAD')
  }

  function writeDoc(path: string, content: string): void {
    const full = join(repo, path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content)
  }

  /** A parser for `#` lines and nothing else, which is all the walk reads from one. */
  function parse(file: SourceFile): Promise<ParsedDoc> {
    const lines = file.content.split('\n').filter((line) => line.startsWith('#'))
    const stack: string[] = []
    return Promise.resolve({
      title: file.path,
      url: `https://x.dev/${file.path}`,
      docType: 'handbook',
      metadata: {},
      sections: lines.map((line) => {
        const text = line.replace(/^#+ /, '')
        const depth = /^#+/.exec(line)?.[0].length ?? 1
        stack.length = depth - 1
        stack.push(text)
        return {
          headingPath: [...stack],
          anchor: text.toLowerCase().replaceAll(' ', '-'),
          blocks: [],
        }
      }),
    })
  }

  const source = (): Source => ({
    id: 'docs',
    repo,
    branch: 'main',
    include: ['docs'],
    license: { name: 'l', url: 'https://x.dev', attribution: 'a' },
    parserVersion: 1,
    match: () => true,
    parse,
  })

  async function drl(...argv: string[]) {
    const out = capture()
    const err = capture()
    const code = await run(argv, {
      out: out.writer,
      err: err.writer,
      root,
      debug: false,
      sources: [source()],
    })
    return { code, out: out.text(), err: err.text() }
  }

  function seedIndex(
    commitSha: string,
    documents: { path: string; title?: string; text: string; anchors: string[] }[],
  ): void {
    const { dimensions } = settings.embeddings
    const indexes = openIndexes(join(root, settings.dataDir), 'docs')
    indexes.index.applyChanges({
      documents: documents.map(({ path, title, text, anchors }, i) => ({
        path,
        url: `https://x.dev/${path}`,
        title: title ?? path,
        docType: 'handbook',
        contentHash: text,
        lastChangedSha: 's',
        chunks: [
          {
            id: `c${String(i)}`,
            ordinal: 0,
            headingPath: [],
            anchor: anchors[0] ?? '',
            blockTypes: ['prose'],
            text,
            metadata: { anchors },
            tokenCount: 5,
            textHash: text,
            vector: Float32Array.from({ length: dimensions }, (_, n) => (n === 0 ? 1 : 0)),
          },
        ],
      })),
      deletePaths: [],
      manifest: {
        sourceId: 'docs',
        repo,
        branch: 'main',
        includePaths: ['docs'],
        commitSha,
        syncedAt: '2026-11-02T00:00:00.000Z',
        embedModel: createEmbeddingProvider(settings.embeddings).id,
        embedDimensions: dimensions,
        contextModel: null,
        chunkerVersion: CHUNKER_VERSION,
        parserVersion: 1,
      },
    })
    indexes.close()
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'drl-draft-'))
    repo = join(root, 'upstream')
    mkdirSync(repo)
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages: []\n')
    gitIn('init', '-q', '-b', 'main')
    gitIn('config', 'user.name', 't')
    gitIn('config', 'user.email', 't@x.dev')
    gitIn('config', 'commit.gpgsign', 'false')
    gitIn('config', 'core.autocrlf', 'false')
    // A placeholder: nothing here sends a request, and the provider's constructor needs one.
    vi.stubEnv('VOYAGE_API_KEY', 'pa-test')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    rmSync(root, { recursive: true, force: true })
  })

  describe('drl eval walk', () => {
    function history(): string {
      writeDoc('docs/old.md', '# Old\n\ntext\n\n## First\n\nmore\n')
      commitAt('2026-01-01T00:00:00Z', 'old page')
      writeDoc('docs/other.md', '# Other\n\nunrelated text of its own, long enough to differ\n')
      commitAt('2026-02-01T00:00:00Z', 'other page')
      // The rename must not make anything in the page look new.
      renameSync(join(repo, 'docs/old.md'), join(repo, 'docs/moved.md'))
      commitAt('2026-03-01T00:00:00Z', 'rename')
      writeDoc('docs/moved.md', '# Old\n\ntext\n\n## First\n\nmore\n\n## Added later\n\nnew\n')
      return commitAt('2026-04-01T00:00:00Z', 'a heading')
    }

    it('lists pages and headings by when they were first added, through a rename', async () => {
      const pinned = history()
      seedIndex(pinned, [
        { path: 'docs/moved.md', text: 't', anchors: [] },
        { path: 'docs/other.md', text: 't', anchors: [] },
      ])

      const { code, out, err } = await drl('eval', 'walk', '--source', 'docs')

      expect(err).toBe('')
      expect(code).toBe(0)
      expect(out).toContain(`The walk of docs at ${pinned.slice(0, 8)}: 2 pages and 4 headings`)
      const lines = out.split('\n').filter((line) => /^\d{4}-/.test(line))
      expect(lines.map((line) => line.replace(/ {2}[0-9a-f]{8} {2}/, ' '))).toEqual([
        '2026-04-01 docs/moved.md#added-later  Added later',
        '2026-02-01 docs/other.md  docs/other.md',
        '2026-02-01 docs/other.md#other  Other',
        '2026-01-01 docs/moved.md  docs/moved.md',
        '2026-01-01 docs/moved.md#old  Old',
        '2026-01-01 docs/moved.md#first  First',
      ])
    })

    it('walks at the index commit, not the head of the branch', async () => {
      const pinned = history()
      seedIndex(pinned, [{ path: 'docs/moved.md', text: 't', anchors: [] }])
      writeDoc('docs/moved.md', '# Old\n\n## Newer than the index\n')
      commitAt('2026-05-01T00:00:00Z', 'after the pin')

      const { out } = await drl('eval', 'walk', '--source', 'docs')

      expect(out).not.toContain('Newer than the index')
      expect(out).toContain('Added later')
    })

    it('stops at --top, and a second run reuses the clone and finds a later commit', async () => {
      const pinned = history()
      seedIndex(pinned, [{ path: 'docs/moved.md', text: 't', anchors: [] }])

      const first = await drl('eval', 'walk', '--source', 'docs', '--top', '1')

      expect(first.out.split('\n').filter((line) => /^\d{4}-/.test(line))).toHaveLength(1)
      expect(existsSync(join(root, settings.cacheDir, 'history', 'docs', 'HEAD'))).toBe(true)

      writeDoc('docs/moved.md', '# Old\n\n## After the clone\n')
      const later = commitAt('2026-05-01T00:00:00Z', 'after the clone')
      seedIndex(later, [{ path: 'docs/moved.md', text: 't', anchors: [] }])

      const second = await drl('eval', 'walk', '--source', 'docs', '--top', '1')

      expect(second.err).toBe('')
      expect(second.out).toContain('After the clone')
    })

    it('says so when the commit is not on the branch', async () => {
      history()
      seedIndex('0'.repeat(40), [{ path: 'docs/moved.md', text: 't', anchors: [] }])

      const { code, err } = await drl('eval', 'walk', '--source', 'docs')

      expect(code).toBe(1)
      expect(err).toContain('is not on main')
    })

    it('needs an index', async () => {
      history()

      const { code } = await drl('eval', 'walk', '--source', 'docs')

      expect(code).toBe(1)
    })
  })

  describe('drl eval check --draft', () => {
    function writeDraft(...rows: unknown[]): void {
      const path = goldenDraftPath(root, 'docs')
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, rows.map((row) => JSON.stringify(row)).join('\n') + '\n')
    }

    const seedOne = (): void => {
      seedIndex('a'.repeat(40), [
        {
          path: 'docs/a.md',
          title: 'Rules of the Page',
          text: 'Rules of the Page > Sec\n\nYou should call the Hook at the top.\n\n## Other part\n\nMore.',
          anchors: ['sec'],
        },
      ])
    }

    it('counts the tags and lists what is copied, and passes with that', async () => {
      seedOne()
      writeDraft(
        {
          id: 'docs-0001',
          question: 'Where do I call the Hook at render?',
          answer: 'A.',
          primary: ['docs/a.md#sec'],
          tags: ['fresh'],
        },
        {
          id: 'docs-0002',
          question: 'What is in the other part?',
          answer: 'A.',
          primary: ['docs/a.md#sec'],
          tags: ['basic', 'fresh'],
        },
        { id: 'docs-0003', question: 'Q?', answer: 'No.', tags: ['unanswerable'] },
      )

      const { code, out, err } = await drl('eval', 'check', '--draft', '--source', 'docs')

      expect(err).toBe('')
      expect(code).toBe(0)
      expect(out).toContain('3 questions: basic 1, fresh 2, unanswerable 1')
      expect(out).toContain('docs-0001: copies a passage: "call the hook at"')
      expect(out).toContain('docs-0002: copies a whole heading: "other part"')
      expect(out).not.toContain('docs-0003')
    })

    it('says when nothing is copied', async () => {
      seedOne()
      writeDraft({
        id: 'docs-0001',
        question: 'Something else entirely?',
        answer: 'A.',
        primary: ['docs/a.md#sec'],
        tags: ['basic'],
      })

      const { out } = await drl('eval', 'check', '--draft', '--source', 'docs')

      expect(out).toContain('No copied wording.')
    })

    it('fails on an anchor that does not resolve, and says which', async () => {
      seedOne()
      writeDraft({
        id: 'docs-0001',
        question: 'Q?',
        answer: 'A.',
        primary: ['docs/a.md#nowhere', { at: 'docs/a.md#sec', contains: 'not in the text' }],
        acceptable: ['docs/b.md'],
        tags: ['basic'],
      })

      const { code, err } = await drl('eval', 'check', '--draft', '--source', 'docs')

      expect(code).toBe(1)
      expect(err).toContain('docs-0001: docs/a.md#nowhere does not resolve (no-section)')
      expect(err).toContain('docs-0001: docs/a.md#sec does not resolve (no-passage)')
      expect(err).toContain('docs-0001: docs/b.md does not resolve (no-document)')
    })

    it('refuses a draft that does not parse', async () => {
      seedOne()
      writeDraft({ id: 'docs-0001', question: 'Q?', answer: 'A.', tags: ['nonsense'] })

      const { code, err } = await drl('eval', 'check', '--draft', '--source', 'docs')

      expect(code).toBe(1)
      expect(err).toContain('nonsense')
    })

    it('says when there is no draft, and takes no --accept', async () => {
      seedOne()

      const missing = await drl('eval', 'check', '--draft', '--source', 'docs')
      expect(missing.code).toBe(1)
      expect(missing.err).toContain('docs has no draft')

      writeDraft({ id: 'docs-0001', question: 'Q?', answer: 'A.', tags: ['unanswerable'] })
      const accepted = await drl('eval', 'check', '--draft', '--accept', '--source', 'docs')
      expect(accepted.code).toBe(1)
      expect(accepted.err).toContain('never accepted as it is')
    })
  })

  it('takes --draft and --top on their own commands only', async () => {
    const draft = await drl('eval', 'walk', '--draft', '--source', 'docs')
    const top = await drl('eval', 'check', '--top', '3', '--source', 'docs')

    expect(draft.err).toContain('--draft does not apply to drl eval walk')
    expect(top.err).toContain('--top does not apply to drl eval check')
  })
})
