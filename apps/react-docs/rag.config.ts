// The react-docs app's own config (SPEC section 4): what this app is, how it looks
// and what it suggests asking. Model IDs, prices, limits and retrieval
// defaults are engine settings and come from @docs-rag-lab/settings (ADR-0007).
import { defineDocsApp } from '@docs-rag-lab/ui'

export default defineDocsApp({
  id: 'react-docs',
  source: 'react',
  title: 'React docs assistant',
  tagline: 'Answers from the React docs, Learn and Reference, with citations',
  // React's blue, darkened for 4.5:1 on every surface; the lighter shade for dark mode.
  theme: { accent: { light: '#0a6f91', dark: '#58c4dc' } },
  placeholder: 'Ask about React',
  docTypeLabels: {
    handbook: 'Learn',
    reference: 'Reference',
  },
  // None of these goes in the golden set (ADR-0016).
  examples: [
    'Why does my Effect run twice in development?',
    'How do I reset state with a `key`?',
    'When do I need `useMemo`?',
    'Чем `useRef` отличается от `useState`?',
  ],
})
