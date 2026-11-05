// A server component: it passes serializable config to the client component.
// The default strategy comes from settings, never from the app config (ADR-0007).
// "Search in" lists the doc types this source has, the ones the config names.
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
      placeholder={config.placeholder}
      docTypes={Object.keys(config.docTypeLabels)}
      docTypeLabels={config.docTypeLabels}
      defaultStrategy={settings.retrieval.strategy}
      theme={config.theme}
      endpoints={{ ask: '/api/ask', search: '/api/search', documents: '/api/documents' }}
      evalHref="/eval"
    />
  )
}
