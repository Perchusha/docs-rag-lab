import { describe, expect, it } from 'vitest'

import config from '../rag.config.ts'
import { appEvalStore, source } from './server.ts'

describe('the server side of this app', () => {
  it('builds the source rag.config.ts names', () => {
    expect(source().id).toBe(config.source)
  })

  it('reads the eval reports of that source', () => {
    expect(appEvalStore().sourceId).toBe('typescript')
  })
})
