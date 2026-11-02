// The ts-docs app's own config (SPEC section 4): what this app is, how it looks
// and what it suggests asking. Model IDs, prices, limits and retrieval
// defaults are engine settings and come from @docs-rag-lab/settings (ADR-0007).
import { defineDocsApp } from '@docs-rag-lab/ui'

export default defineDocsApp({
  id: 'ts-docs',
  source: 'typescript',
  title: 'TypeScript docs assistant',
  tagline: 'Answers from the TypeScript handbook, reference and release notes, with citations',
  // TypeScript blue, darkened for 4.5:1 on white; the lighter shade for dark mode.
  theme: { accent: { light: '#235a97', dark: '#79b8ff' } },
  examples: [
    'In which version did `satisfies` appear?',
    'What does error TS2345 mean?',
    'What does the `strict` flag enable?',
    'В чём разница между `unknown` и `any`?',
  ],
})
