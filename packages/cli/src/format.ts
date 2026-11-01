import type {
  EmbedProgress,
  NumberedCitation,
  RetrievalTrace,
  SyncReport,
  TraceList,
} from '@docs-rag-lab/core'

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

const SCORING_LABEL: Record<TraceList['scoring'], string> = {
  'cosine-distance': 'cosine distance, lower is better',
  bm25: 'BM25, higher is better',
}

const ms = (value: number): string => `${value.toFixed(1)}ms`

function more(total: number, shown: number): string[] {
  return total > shown ? [`      (${count(total - shown)} more)`] : []
}

/**
 * The retrieval trace as text: the query, each candidate list, the fused
 * ranking and the final context. Lists show their first `limit` entries;
 * `drl search --json` prints everything.
 */
export function formatTrace(trace: RetrievalTrace, limit = 10): string {
  const label = (chunkId: string): string => {
    const chunk = trace.chunks[chunkId]
    if (chunk === undefined) return chunkId
    return `${[chunk.title, ...chunk.headingPath].join(' > ')}  [${chunk.docType}]`
  }
  const { terms, exactTokens } = trace.query
  const lines = [
    `retrieval: ${trace.strategy} over ${trace.sourceId}, top ${String(trace.params.topK)}`,
    `terms: ${terms.length === 0 ? 'none' : terms.join(', ')}`,
    `exact tokens: ${exactTokens.length === 0 ? 'none' : exactTokens.map((t) => `${t.token} (${t.from})`).join(', ')}`,
    `doc types: ${trace.filters.docTypes.length === 0 ? 'all' : trace.filters.docTypes.join(', ')}`,
    `query vector: from ${trace.embedding.from}, ${ms(trace.embedding.ms)}`,
  ]

  for (const list of trace.lists) {
    lines.push('')
    if (list.skipped !== undefined) {
      lines.push(`${list.name}: skipped, ${list.skipped}`)
      continue
    }
    const query = list.query === undefined ? '' : `, ${list.query}`
    lines.push(
      `${list.name} (${SCORING_LABEL[list.scoring]}): ${count(list.candidates.length)} candidates, ${ms(list.ms)}${query}`,
    )
    const digits = list.scoring === 'bm25' ? 2 : 4
    for (const c of list.candidates.slice(0, limit)) {
      lines.push(
        `  ${String(c.rank).padStart(2)}. ${c.score.toFixed(digits).padStart(7)}  ${label(c.chunkId)}`,
      )
    }
    lines.push(...more(list.candidates.length, limit))
  }

  if (trace.fusion.method === 'rrf') {
    const { ranked } = trace.fusion
    const shown = Math.max(limit, trace.params.topK)
    lines.push(
      '',
      `fused (RRF, k=${String(trace.fusion.k)}): ${count(ranked.length)} candidates, ${ms(trace.fusion.ms)}`,
    )
    for (const entry of ranked.slice(0, shown)) {
      const ranks = trace.lists
        .filter((list) => list.skipped === undefined)
        .map((list) => `${list.name.charAt(0)}${String(entry.ranks[list.name] ?? '-').padEnd(2)}`)
        .join(' ')
      lines.push(
        `  ${String(entry.rank).padStart(2)}. ${entry.score.toFixed(4)}  ${ranks}  ${label(entry.chunkId)}`,
      )
    }
    lines.push(...more(ranked.length, shown))
  }

  lines.push('', `context: ${count(trace.context.length)} chunks go to the answer`)
  for (const chunk of trace.context) {
    lines.push(`  ${String(chunk.rank).padStart(2)}. ${chunk.title}\n      ${chunk.source}`)
  }
  lines.push('', `retrieval time: ${ms(trace.totalMs)}`)
  return lines.join('\n')
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
