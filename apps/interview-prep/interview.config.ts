// The interview-prep app's own config (ADR-0018): what this app is, how it looks and which
// technologies it offers. Model IDs, prices and limits are engine settings and come from
// @docs-rag-lab/settings (ADR-0007).
import { defineInterviewApp } from '@docs-rag-lab/ui'

export default defineInterviewApp({
  id: 'interview-prep',
  title: 'Interview prep',
  tagline:
    'Questions from the TypeScript and React docs, with answers the compiler or the docs back',
  // Violet, 4.5:1 or more on white; the lighter shade for dark mode.
  theme: { accent: { light: '#6f42c1', dark: '#b392f0' } },
  sources: [
    { id: 'typescript', title: 'TypeScript' },
    { id: 'react', title: 'React' },
  ],
})
