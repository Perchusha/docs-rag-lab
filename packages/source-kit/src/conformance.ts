// The source conformance suite (SPEC section 7). Every source runs it over its
// fixtures. It returns failures instead of asserting, so it has no test-runner
// dependency and stays importable at runtime.
import { chunkDocument, type Chunk } from './chunker.ts'
import { DOC_TYPES, type Block, type ParsedDoc, type Source, type SourceFile } from './types.ts'

export interface ConformanceFixtures {
  files: readonly SourceFile[]
  /** Every document URL must match this pattern. */
  urlPattern: RegExp
}

export interface ConformanceReport {
  failures: string[]
}

function codeBlocks(blocks: readonly Block[]): string[] {
  return blocks.flatMap((block) => {
    if (block.kind === 'code') return [block.code]
    if (block.kind === 'callout') return codeBlocks(block.blocks)
    return []
  })
}

// A code line may sit after container indentation or blockquote markers.
const CONTAINER_PREFIX = /^[\s>]*$/

/**
 * Finds `code` as consecutive lines of `lines`, starting at `from`: each source
 * line must end with the code line and have only container prefix before it.
 * Returns the index after the match, or -1.
 */
function findCodeLines(lines: readonly string[], code: string, from: number): number {
  const codeLines = code.split('\n')
  for (let start = from; start + codeLines.length <= lines.length; start++) {
    const matches = codeLines.every((codeLine, offset) => {
      const line = lines[start + offset] ?? ''
      if (!line.endsWith(codeLine)) return false
      return CONTAINER_PREFIX.test(line.slice(0, line.length - codeLine.length))
    })
    if (matches) return start + codeLines.length
  }
  return -1
}

function checkDocument(
  file: SourceFile,
  doc: ParsedDoc,
  chunks: readonly Chunk[],
  urlPattern: RegExp,
): string[] {
  const failures: string[] = []
  const fail = (message: string): void => {
    failures.push(`${file.path}: ${message}`)
  }

  let url: URL | undefined
  try {
    url = new URL(doc.url)
  } catch {
    fail(`url is not absolute: ${doc.url}`)
  }
  if (url !== undefined && url.protocol !== 'https:') fail(`url is not https: ${doc.url}`)
  if (!urlPattern.test(doc.url)) fail(`url does not match ${String(urlPattern)}: ${doc.url}`)
  if (doc.title.trim() === '') fail('title is empty')
  if (!DOC_TYPES.includes(doc.docType)) fail(`unknown docType: ${doc.docType}`)

  for (const section of doc.sections) {
    if (section.headingPath.some((heading) => heading.trim() === '')) {
      fail(`empty heading in ${JSON.stringify(section.headingPath)}`)
    }
    if (/[\s#]/.test(section.anchor)) fail(`invalid anchor: ${JSON.stringify(section.anchor)}`)
  }

  if (chunks.length === 0) fail('produced no chunks')
  const ids = new Set<string>()
  for (const chunk of chunks) {
    if (ids.has(chunk.id)) fail(`duplicate chunk id ${chunk.id}`)
    ids.add(chunk.id)
    const prefixEnd = chunk.text.indexOf('\n\n')
    if (prefixEnd === -1 || chunk.text.slice(prefixEnd).trim() === '') {
      fail(`empty chunk ${chunk.id} (${chunk.headingPath.join(' > ')})`)
    }
  }

  const sourceLines = file.content.split('\n')
  let cursor = 0
  for (const code of doc.sections.flatMap((section) => codeBlocks(section.blocks))) {
    const label = JSON.stringify(code.split('\n')[0]?.slice(0, 60) ?? '')
    const next = findCodeLines(sourceLines, code, cursor)
    if (next === -1) fail(`code block starting ${label} is not verbatim in the source`)
    else cursor = next
    if (!chunks.some((chunk) => chunk.text.includes(code))) {
      fail(`code block starting ${label} is not whole in any chunk`)
    }
  }
  return failures
}

/**
 * Checks a source against its fixtures:
 * - the parser version is a positive integer;
 * - every fixture matches and parses without throwing;
 * - URLs are absolute https and match the expected pattern; docType is known;
 * - two parses give the same chunk IDs and hashes, and IDs are unique;
 * - no chunk is empty;
 * - code blocks are verbatim copies of the source and are never split.
 */
export async function runSourceConformance(
  source: Source,
  fixtures: ConformanceFixtures,
): Promise<ConformanceReport> {
  const failures: string[] = []
  if (!Number.isInteger(source.parserVersion) || source.parserVersion <= 0) {
    failures.push(`parserVersion must be a positive integer, got ${String(source.parserVersion)}`)
  }
  if (fixtures.files.length === 0) failures.push('no fixtures')

  for (const file of fixtures.files) {
    if (!source.match(file.path)) {
      failures.push(`${file.path}: source.match() rejects a fixture`)
      continue
    }
    let first: ParsedDoc
    let second: ParsedDoc
    try {
      first = await source.parse(file, { commitSha: undefined })
      second = await source.parse(file, { commitSha: undefined })
    } catch (error) {
      failures.push(
        `${file.path}: parse threw: ${error instanceof Error ? error.message : String(error)}`,
      )
      continue
    }
    const chunks = chunkDocument(file.path, first)
    const again = chunkDocument(file.path, second)
    const fingerprint = (list: readonly Chunk[]) =>
      list.map((chunk) => `${chunk.id}:${chunk.textHash}`)
    if (JSON.stringify(fingerprint(chunks)) !== JSON.stringify(fingerprint(again))) {
      failures.push(`${file.path}: two parses gave different chunks`)
    }
    failures.push(...checkDocument(file, first, chunks, fixtures.urlPattern))
  }
  return { failures }
}
