import { describe, expect, it } from 'vitest'

import { reactSource } from './index.ts'
import { interviewTopicOf } from './interview.ts'

const topicOf = (path: string, title = 'A page') =>
  interviewTopicOf({ path, docType: path.includes('/learn/') ? 'handbook' : 'reference', title })

describe('interviewTopicOf (ADR-0018)', () => {
  it('makes each Learn page a topic', () => {
    expect(
      topicOf('src/content/learn/synchronizing-with-effects.md', 'Synchronizing with Effects'),
    ).toEqual({
      id: 'learn/synchronizing-with-effects',
      title: 'Synchronizing with Effects',
      group: 'Learn',
    })
    expect(topicOf('src/content/learn/react-compiler/introduction.md', 'Introduction')).toEqual({
      id: 'learn/react-compiler/introduction',
      title: 'Introduction',
      group: 'Learn',
    })
  })

  it('aggregates Reference pages by folder, with the hooks apart', () => {
    expect(topicOf('src/content/reference/react/useEffect.md')).toEqual({
      id: 'reference/hooks',
      title: 'Hooks',
      group: 'Reference',
    })
    expect(topicOf('src/content/reference/react/use.md')?.id).toBe('reference/hooks')
    expect(topicOf('src/content/reference/react/memo.md')).toEqual({
      id: 'reference/react',
      title: 'React APIs and components',
      group: 'Reference',
    })
    expect(topicOf('src/content/reference/react-dom/components/input.md')?.title).toBe('React DOM')
    expect(topicOf('src/content/reference/eslint-plugin-react-hooks/lints/purity.md')?.id).toBe(
      'reference/eslint-plugin-react-hooks',
    )
    expect(topicOf('src/content/reference/new-folder/page.md')).toEqual({
      id: 'reference/new-folder',
      title: 'new-folder',
      group: 'Reference',
    })
  })

  it('leaves out the pages about setting up tools, by the rule (ADR-0018)', () => {
    for (const page of [
      'learn/installation',
      'learn/creating-a-react-app',
      'learn/build-a-react-app-from-scratch',
      'learn/add-react-to-an-existing-project',
      'learn/setup',
      'learn/editor-setup',
      'learn/react-developer-tools',
      'learn/react-compiler/installation',
      'learn/react-compiler/incremental-adoption',
      'learn/react-compiler/debugging',
      'reference/react-compiler/gating',
      'reference/react-compiler/directives/use-memo',
      'reference/dev-tools/react-performance-tracks',
      'reference/eslint-plugin-react-hooks/index',
    ]) {
      expect(topicOf(`src/content/${page}.md`), page).toBeUndefined()
    }
  })

  it('keeps what explains React, even through a tool', () => {
    expect(topicOf('src/content/learn/typescript.md')?.id).toBe('learn/typescript')
    expect(topicOf('src/content/learn/react-compiler/introduction.md')?.id).toBe(
      'learn/react-compiler/introduction',
    )
    expect(topicOf('src/content/reference/eslint-plugin-react-hooks/lints/purity.md')?.id).toBe(
      'reference/eslint-plugin-react-hooks',
    )
  })

  it('is what the source gives', () => {
    const document = {
      path: 'src/content/reference/rsc/use-client.md',
      docType: 'reference' as const,
      title: "'use client'",
    }

    expect(reactSource().interviewTopic?.(document)).toEqual(interviewTopicOf(document))
    expect('displayCode' in reactSource()).toBe(false)
  })
})
