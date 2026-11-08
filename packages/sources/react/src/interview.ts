// Where each react.dev page sits in the interview-prep app's topic map (ADR-0018). Each Learn
// page is a topic. Reference pages are aggregated by their folder, with the hooks apart from the
// rest of `reference/react`, since there are 129 of them.
import type { InterviewDocument, InterviewTopic } from '@docs-rag-lab/source-kit'

const LEARN = 'src/content/learn/'
const REFERENCE = 'src/content/reference/'

/** The reference folders, by name, as the topic map lists them. */
const REFERENCE_TOPICS: Readonly<Record<string, string>> = {
  react: 'React APIs and components',
  'react-dom': 'React DOM',
  rsc: 'Server Components',
  rules: 'Rules of React',
  'react-compiler': 'React Compiler',
  'eslint-plugin-react-hooks': 'Hooks lint rules',
  'dev-tools': 'Developer tools',
}

export function interviewTopicOf(document: InterviewDocument): InterviewTopic | undefined {
  if (document.path.startsWith(LEARN)) {
    const id = document.path.slice('src/content/'.length).replace(/\.md$/, '')
    return { id, title: document.title, group: 'Learn' }
  }
  if (!document.path.startsWith(REFERENCE)) return undefined
  const [folder = '', page = ''] = document.path.slice(REFERENCE.length).split('/')
  if (folder === 'react' && /^use[A-Z]?\w*\.md$/.test(page)) {
    return { id: 'reference/hooks', title: 'Hooks', group: 'Reference' }
  }
  const name = folder.replace(/\.md$/, '')
  return { id: `reference/${name}`, title: REFERENCE_TOPICS[name] ?? name, group: 'Reference' }
}
