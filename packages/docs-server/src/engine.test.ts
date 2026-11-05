import type { Engine, Source } from '@docs-rag-lab/core'
import { describe, expect, it, vi } from 'vitest'

import { appSource, onceEngine } from './engine.ts'

const source = { id: 'demo' } as unknown as Source
const engine = { sources: [source] } as unknown as Engine

describe('appSource', () => {
  it('builds the source rag.config.ts names', () => {
    expect(appSource('demo', { demo: () => source })).toBe(source)
  })

  it('refuses a source the app cannot build', () => {
    expect(() => appSource('react', { typescript: () => source })).toThrow(
      'rag.config.ts names the source "react", which this app cannot build (known: typescript)',
    )
  })
})

describe('onceEngine', () => {
  it('builds nothing before the first call', () => {
    const build = vi.fn(() => engine)

    onceEngine(() => source, build)

    expect(build).not.toHaveBeenCalled()
  })

  it('keeps one engine, so that the rate limiter sees every request', () => {
    const build = vi.fn(() => engine)
    const appEngine = onceEngine(() => source, build)

    expect(appEngine()).toBe(engine)
    expect(appEngine()).toBe(engine)
    expect(build).toHaveBeenCalledTimes(1)
    expect(build).toHaveBeenCalledWith(source)
  })

  it('tries again after a failure, which a route turns into a response', () => {
    const build = vi
      .fn<(from: Source) => Engine>()
      .mockImplementationOnce(() => {
        throw new Error('no key')
      })
      .mockReturnValue(engine)
    const appEngine = onceEngine(() => source, build)

    expect(appEngine).toThrow('no key')
    expect(appEngine()).toBe(engine)
  })
})
