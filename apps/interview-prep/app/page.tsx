// A server component: it passes serializable config to the client component (ADR-0018).
import { InterviewPrep } from '@docs-rag-lab/ui'

import config from '../interview.config.ts'

export default function Page() {
  return (
    <InterviewPrep
      title={config.title}
      tagline={config.tagline}
      sources={config.sources}
      theme={config.theme}
      endpoints={{
        overview: '/api/interview/overview',
        deck: '/api/interview/deck',
        review: '/api/interview/review',
        flag: '/api/interview/flag',
        mock: '/api/interview/mock',
        mockAnswer: '/api/interview/mock/answer',
        mockSummary: '/api/interview/mock/summary',
        check: '/api/interview/check',
      }}
    />
  )
}
