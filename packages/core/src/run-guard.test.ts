// Against real repositories in the OS temp dir (no network).
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { git } from '@docs-rag-lab/source-kit'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { EmbeddingProvider } from './embeddings/provider.ts'
import type { RerankProvider } from './rerank/provider.ts'
import { guardEmbeddings, guardReranker, RunMovedError, startRunGuard } from './run-guard.ts'

let root: string

const commit = (message: string) =>
  git(
    [
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@example.com',
      'commit',
      '-q',
      '--allow-empty',
      '-m',
      message,
    ],
    { cwd: root },
  )

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'drl-run-guard-'))
  await git(['init', '-q', '-b', 'work'], { cwd: root })
  await commit('first')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

async function guardHere() {
  const guard = await startRunGuard(root)
  if (guard === undefined) throw new Error('no guard')
  return guard
}

describe('startRunGuard', () => {
  it('stays quiet while nothing moved', async () => {
    const guard = await guardHere()

    await expect(guard.check()).resolves.toBeUndefined()
    await expect(guard.check()).resolves.toBeUndefined()
  })

  it('stops when the branch changes, also at the same commit', async () => {
    const guard = await guardHere()

    await git(['checkout', '-q', '-b', 'other'], { cwd: root })

    await expect(guard.check()).rejects.toThrow(RunMovedError)
    await expect(guard.check()).rejects.toThrow(
      /started at \w{8} on work, and is now at \w{8} on other/,
    )
  })

  it('stops when HEAD moves, also on the same branch', async () => {
    const guard = await guardHere()

    await commit('second')

    await expect(guard.check()).rejects.toThrow(RunMovedError)
  })

  it('stops when the branch is left for no branch', async () => {
    const guard = await guardHere()

    await git(['checkout', '-q', '--detach'], { cwd: root })

    await expect(guard.check()).rejects.toThrow(/and is now at \w{8} on no branch/)
  })

  it('stays quiet after going away and coming back, since only the position counts', async () => {
    const guard = await guardHere()

    await git(['checkout', '-q', '-b', 'other'], { cwd: root })
    await git(['checkout', '-q', 'work'], { cwd: root })

    await expect(guard.check()).resolves.toBeUndefined()
  })

  it('stops when the repository can no longer be read', async () => {
    const guard = await guardHere()

    rmSync(join(root, '.git'), { recursive: true, force: true })

    await expect(guard.check()).rejects.toThrow('could not tell whether the repository')
  })

  it('has nothing to hold outside a repository', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'drl-run-guard-outside-'))
    try {
      await expect(startRunGuard(outside)).resolves.toBeUndefined()
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })
})

describe('the guarded providers', () => {
  const embedded: string[][] = []
  const provider: EmbeddingProvider = {
    id: 'fake:embed:3',
    model: 'embed',
    dimensions: 3,
    limits: { maxInputs: 1, maxTokens: 1 },
    embed: (texts) => {
      embedded.push([...texts])
      return Promise.resolve({ vectors: [], tokens: 1 })
    },
  }
  const reranked: string[] = []
  const reranker: RerankProvider = {
    id: 'fake:rerank',
    model: 'rerank',
    rerank: (query) => {
      reranked.push(query)
      return Promise.resolve({ scores: [], tokens: 1 })
    },
  }

  beforeEach(() => {
    embedded.length = 0
    reranked.length = 0
  })

  it('pass the call on while nothing moved, and keep what names the provider', async () => {
    const guard = await guardHere()
    const embeddings = guardEmbeddings(provider, guard)
    const rerank = guardReranker(reranker, guard)

    await embeddings.embed(['a'], 'query')
    await rerank.rerank('q', ['d'])

    expect(embedded).toEqual([['a']])
    expect(reranked).toEqual(['q'])
    expect(embeddings).toMatchObject({ id: provider.id, model: 'embed', dimensions: 3 })
    expect(rerank).toMatchObject({ id: reranker.id, model: 'rerank' })
  })

  it('make no call once it moved', async () => {
    const guard = await guardHere()
    await commit('second')

    await expect(guardEmbeddings(provider, guard).embed(['a'], 'query')).rejects.toThrow(
      RunMovedError,
    )
    await expect(guardReranker(reranker, guard).rerank('q', ['d'])).rejects.toThrow(RunMovedError)

    expect(embedded).toEqual([])
    expect(reranked).toEqual([])
  })

  it('are the providers themselves with no guard', () => {
    expect(guardEmbeddings(provider, undefined)).toBe(provider)
    expect(guardReranker(reranker, undefined)).toBe(reranker)
  })
})
