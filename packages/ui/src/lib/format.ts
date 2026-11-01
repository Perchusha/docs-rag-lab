// Text for numbers and labels the components show. Pure, so the wording is
// tested once here.
import type { TraceChunk, TraceList, UsageSummary } from '@docs-rag-lab/contracts'

const INTEGER = new Intl.NumberFormat('en-US')

export function formatMs(ms: number): string {
  return ms < 10 ? `${ms.toFixed(1)} ms` : `${INTEGER.format(Math.round(ms))} ms`
}

/** A list's own score: cosine distance to 3 decimals, BM25 to 2. */
export function formatScore(scoring: TraceList['scoring'], score: number): string {
  return scoring === 'cosine-distance' ? score.toFixed(3) : score.toFixed(2)
}

export function formatRrf(score: number): string {
  return score.toFixed(4)
}

/** A chunk as the citations name it: the document title, then the section it starts in. */
export function chunkTitle(chunk: Pick<TraceChunk, 'title' | 'sectionPath'>): string {
  return [chunk.title, ...chunk.sectionPath].join(' > ')
}

/** The doc's folder and file name, plus the anchor: the same rule for every source's layout. */
export function chunkLocation(chunk: Pick<TraceChunk, 'docPath' | 'anchor'>): string {
  const path = chunk.docPath.split('/').slice(-2).join('/')
  return chunk.anchor === '' ? path : `${path}#${chunk.anchor}`
}

/** Tokens and cost of one answer or search, from the engine's usage summary. */
export function formatUsage(usage: UsageSummary): string {
  const models = usage.models.map((m) => {
    if (m.kind === 'embedding') {
      const cached = m.cacheHits > 0 ? `, ${INTEGER.format(m.cacheHits)} cached` : ''
      return `${m.model} ${INTEGER.format(m.inputTokens)} tokens${cached}`
    }
    return `${m.model} ${INTEGER.format(m.inputTokens)} in, ${INTEGER.format(m.outputTokens)} out`
  })
  const unpriced = usage.unpriced.length > 0 ? ` (no price for ${usage.unpriced.join(', ')})` : ''
  return `${models.join('; ')}. About $${usage.costUsd.toFixed(4)} at list prices checked ${usage.pricesChecked}${unpriced}.`
}
