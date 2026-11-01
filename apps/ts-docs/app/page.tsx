// A server component: it passes serializable config to the client component.
// Engine values the page needs (the default strategy, the doc types) come from
// settings and core, never from the app config (ADR-0007).
import { DOC_TYPES } from '@docs-rag-lab/core'
import { settings } from '@docs-rag-lab/settings'
import { DocsAssistant } from '@docs-rag-lab/ui'

import config from '../rag.config.ts'

export default function Page() {
  return (
    <DocsAssistant
      title={config.title}
      tagline={config.tagline}
      sourceId={config.source}
      examples={config.examples}
      docTypes={DOC_TYPES}
      defaultStrategy={settings.retrieval.strategy}
      theme={config.theme}
      endpoints={{ ask: '/api/ask', search: '/api/search', documents: '/api/documents' }}
    />
  )
}
