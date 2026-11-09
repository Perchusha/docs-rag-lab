// Where each react.dev page sits in the interview-prep app's topic map (ADR-0018). Each Learn
// page is a topic. Reference pages are aggregated by their folder, with the hooks apart from the
// rest of `reference/react`, since there are 129 of them. Pages about setting up tools stay out.
import type { InterviewDocument, InterviewTopic } from '@docs-rag-lab/source-kit'

const CONTENT = 'src/content/'
const LEARN = 'learn/'
const REFERENCE = 'reference/'

/**
 * The pages about installing, setting up or configuring a tool rather than about React itself, by
 * ADR-0018's rule: they stay out of the bank and the topic map. Each entry is a page, or a folder
 * when it ends with a slash. A lint rule that states a Rule of React is about React, and stays;
 * so does what React Compiler does, in its introduction.
 */
export const TOOL_PAGES: readonly string[] = [
  // Starting a project, and the editor and developer tools.
  'learn/installation',
  'learn/creating-a-react-app',
  'learn/build-a-react-app-from-scratch',
  'learn/add-react-to-an-existing-project',
  'learn/setup',
  'learn/editor-setup',
  'learn/react-developer-tools',
  'reference/dev-tools/',
  // Installing, adopting, configuring and debugging React Compiler, a build tool.
  'learn/react-compiler/installation',
  'learn/react-compiler/incremental-adoption',
  'learn/react-compiler/debugging',
  'reference/react-compiler/',
  // Installing and configuring the lint plugin, whose rules stay.
  'reference/eslint-plugin-react-hooks/index',
]

const isToolPage = (page: string): boolean =>
  TOOL_PAGES.some((entry) => (entry.endsWith('/') ? page.startsWith(entry) : page === entry))

/** The reference folders, by name, as the topic map lists them. */
const REFERENCE_TOPICS: Readonly<Record<string, string>> = {
  react: 'React APIs and components',
  'react-dom': 'React DOM',
  rsc: 'Server Components',
  rules: 'Rules of React',
  'eslint-plugin-react-hooks': 'Hooks lint rules',
}

export function interviewTopicOf(document: InterviewDocument): InterviewTopic | undefined {
  if (!document.path.startsWith(CONTENT)) return undefined
  const page = document.path.slice(CONTENT.length).replace(/\.md$/, '')
  if (isToolPage(page)) return undefined
  if (page.startsWith(LEARN)) return { id: page, title: document.title, group: 'Learn' }
  if (!page.startsWith(REFERENCE)) return undefined
  const [folder = '', name = ''] = page.slice(REFERENCE.length).split('/')
  if (folder === 'react' && /^use[A-Z]?\w*$/.test(name)) {
    return { id: 'reference/hooks', title: 'Hooks', group: 'Reference' }
  }
  return {
    id: `reference/${folder}`,
    title: REFERENCE_TOPICS[folder] ?? folder,
    group: 'Reference',
  }
}
