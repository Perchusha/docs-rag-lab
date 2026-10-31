import type { EmbedProgress, NumberedCitation, SearchHit, SyncReport } from '@docs-rag-lab/core'

const count = (n: number): string => n.toLocaleString('en-US')

export function formatDuration(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const totalSeconds = Math.round(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const pad = (n: number): string => String(n).padStart(2, '0')
  return hours > 0
    ? `${String(hours)}h ${pad(minutes)}m ${pad(seconds)}s`
    : `${String(minutes)}m ${pad(seconds)}s`
}

export function formatEmbedProgress(progress: EmbedProgress, elapsedMs: number): string {
  const percent =
    progress.toEmbed === 0 ? 100 : Math.floor((progress.embedded / progress.toEmbed) * 100)
  return (
    `embedding: ${count(progress.embedded)}/${count(progress.toEmbed)} chunks (${String(percent)}%), ` +
    `${count(progress.cached)} from cache, ${formatDuration(elapsedMs)} elapsed, ` +
    `${formatDuration(progress.waitedMs)} waiting on rate limits`
  )
}

export function formatSyncReport(report: SyncReport, elapsedMs: number, waitedMs: number): string {
  const { documents: d, chunks: c, vectors: v, stats } = report
  const lines = [
    `sync: ${report.mode}${report.reason === undefined ? '' : ` (${report.reason})`}, ` +
      `${report.previousSha?.slice(0, 8) ?? 'none'} -> ${report.headSha.slice(0, 8)}`,
    `documents: ${count(d.added)} added, ${count(d.modified)} modified, ${count(d.unchanged)} unchanged, ${count(d.deleted)} deleted`,
    `chunks: ${count(c.added)} added, ${count(c.changed)} changed, ${count(c.unchanged)} unchanged, ${count(c.deleted)} deleted`,
    `vectors: ${count(v.needed)} needed, ${count(v.embedded)} embedded, ${count(v.cached)} from cache` +
      (v.embedded > 0 ? `, ${count(report.estimatedTokens)} estimated tokens sent` : ''),
    `index: ${count(stats.documents)} documents, ${count(stats.chunks)} chunks, ${count(stats.tokens)} estimated tokens`,
    ...stats.byDocType.map(
      (row) =>
        `  ${row.docType.padEnd(14)} ${count(row.documents).padStart(5)} docs ${count(row.chunks).padStart(6)} chunks ${count(row.tokens).padStart(9)} tokens`,
    ),
    `time: ${formatDuration(elapsedMs)}, of which ${formatDuration(waitedMs)} waiting on rate limits`,
  ]
  return lines.join('\n')
}

/** The ratio of billed to estimated tokens, to calibrate the local estimate. */
export function formatEstimateRatio(billed: number, estimated: number): string | undefined {
  if (billed === 0 || estimated === 0) return undefined
  return `tokens: ${count(billed)} billed vs ${count(estimated)} estimated (billed/estimated ${(billed / estimated).toFixed(2)})`
}

export function formatHits(hits: readonly SearchHit[]): string {
  return hits
    .map(
      (hit, i) =>
        `${String(i + 1).padStart(2)}. ${hit.distance.toFixed(4)}  ${[hit.title, ...hit.headingPath].join(' > ')}  [${hit.docType}]`,
    )
    .join('\n')
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 3).trimEnd()}...`
}

export function formatCitations(citations: readonly NumberedCitation[]): string {
  if (citations.length === 0) return 'Sources: none cited.'
  return [
    'Sources:',
    ...citations.map(
      (c) =>
        `[${String(c.number)}] ${c.title}\n    ${c.source}\n    "${oneLine(c.citedText, 160)}"`,
    ),
  ].join('\n')
}
