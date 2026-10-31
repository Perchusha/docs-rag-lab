// Heading-based chunker (SPEC section 9, ADR-0003, ADR-0004).
//
// The sections of a document form a tree by heading path. A subtree that fits
// in `maxTokens` becomes one chunk, with nested headings rendered as markdown
// headings. A subtree that does not fit is cut into packs: its own blocks and
// the child subtrees that fit are packed in order into balanced chunks, and
// each child that does not fit is chunked the same way, recursively.
//
// Code blocks are never split. A prose block that alone exceeds the budget is
// split at line boundaries (a table repeats its header rows in every part).
import { sha256Hex } from './hash.ts'
import { estimateTokens } from './tokens.ts'
import type { Block, ParsedDoc, Section } from './types.ts'

/** Bump when chunk boundaries or chunk text change: it forces a full rebuild. */
export const CHUNKER_VERSION = 1

export const DEFAULT_MAX_TOKENS = 800

export interface Chunk {
  /** Stable across syncs: derived from doc path, heading path, occurrence and ordinal. */
  id: string
  docPath: string
  /** Position of the chunk in its document. */
  ordinal: number
  headingPath: string[]
  /** URL fragment of the first section in the chunk, '' for none. */
  anchor: string
  /** Block kinds in the chunk, in order of first appearance. */
  blockTypes: string[]
  /** Heading-path prefix line, then the rendered blocks. */
  text: string
  textHash: string
  tokenCount: number
  /** Character ranges of the rendered blocks in `text`; a heading is joined to the block after it. */
  spans: [number, number][]
}

export interface ChunkOptions {
  maxTokens?: number
}

type PieceKind = 'heading' | Block['kind']

interface Piece {
  kind: PieceKind
  text: string
  tokens: number
}

interface Node {
  section: Section
  depth: number
  /** How many earlier sections in the document have the same heading path. */
  occurrence: number
  children: Node[]
}

interface Item {
  pieces: Piece[]
  tokens: number
  anchor: string
  /** Set when the item is a whole child subtree. */
  child?: Node
}

function piece(kind: PieceKind, text: string): Piece {
  return { kind, text, tokens: estimateTokens(text) }
}

function sumTokens(pieces: readonly { tokens: number }[]): number {
  return pieces.reduce((sum, p) => sum + p.tokens, 0)
}

function hasContent(pieces: readonly Piece[]): boolean {
  return pieces.some((p) => p.kind !== 'heading' && p.text.trim() !== '')
}

function longestBacktickRun(text: string): number {
  return Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length))
}

/** The markdown for one block. Code is fenced byte-for-byte. */
export function renderBlock(block: Block): string {
  switch (block.kind) {
    case 'prose':
      return block.text.trim()
    case 'code': {
      const fence = '`'.repeat(Math.max(3, longestBacktickRun(block.code) + 1))
      return `${fence}${block.lang}\n${block.code}\n${fence}`
    }
    case 'callout':
      return [`[${block.variant}]`, ...block.blocks.map(renderBlock)].join('\n\n')
  }
}

/**
 * Packs items in order into groups of at most `max` tokens, aiming for equal
 * sizes: an item joins the current group unless that would exceed `max` or
 * move the group further from the target size than leaving it out. The target
 * is recomputed for what remains after each group. An item larger than `max`
 * gets a group of its own.
 */
export function packBalanced<T>(
  items: readonly T[],
  tokensOf: (item: T) => number,
  max: number,
): T[][] {
  if (items.length === 0) return []
  let remaining = items.reduce((sum, item) => sum + tokensOf(item), 0)
  if (remaining <= max) return [[...items]]
  const targetFor = (total: number): number => total / Math.ceil(total / max)
  let target = targetFor(remaining)
  const packs: T[][] = []
  let current: T[] = []
  let size = 0
  for (const item of items) {
    const tokens = tokensOf(item)
    const overflows = size + tokens > max
    const drifts = Math.abs(size + tokens - target) > Math.abs(size - target)
    if (current.length > 0 && (overflows || drifts)) {
      packs.push(current)
      remaining -= size
      target = targetFor(remaining)
      current = []
      size = 0
    }
    current.push(item)
    size += tokens
  }
  if (current.length > 0) packs.push(current)
  return packs
}

const TABLE_SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/

const FENCE = /^\s*(`{3,}|~{3,})/

/**
 * Groups lines into units that may not be split: a fenced code block nested in
 * prose (inside a list item, say) is one unit, every other line is its own.
 */
function lineUnits(lines: readonly string[]): string[] {
  const units: string[] = []
  let fence: { marker: string; lines: string[] } | undefined
  for (const line of lines) {
    if (fence !== undefined) {
      fence.lines.push(line)
      const close = FENCE.exec(line)?.[1]
      const sameKind = close?.startsWith(fence.marker.charAt(0)) === true
      if (close !== undefined && sameKind && close.length >= fence.marker.length) {
        units.push(fence.lines.join('\n'))
        fence = undefined
      }
      continue
    }
    const open = FENCE.exec(line)?.[1]
    if (open === undefined) units.push(line)
    else fence = { marker: open, lines: [line] }
  }
  if (fence !== undefined) units.push(fence.lines.join('\n'))
  return units
}

/** Splits an oversized prose block at line boundaries, never inside a nested code fence. */
function splitProse(text: string, max: number): string[] {
  if (estimateTokens(text) <= max) return [text]
  const lines = text.split('\n')
  const isTable =
    lines.length > 2 && lines[0]?.includes('|') === true && TABLE_SEPARATOR.test(lines[1] ?? '')
  const header = isTable ? lines.slice(0, 2) : []
  const body = lineUnits(isTable ? lines.slice(2) : lines)
  const headerTokens = estimateTokens(header.join('\n'))
  return packBalanced(body, (unit) => estimateTokens(unit) + 1, Math.max(1, max - headerTokens))
    .map((group) => [...header, ...group].join('\n').trim())
    .filter((part) => part !== '')
}

function ownPieces(node: Node, max: number): Piece[] {
  return node.section.blocks.flatMap((block) => {
    const text = renderBlock(block)
    if (text === '') return []
    if (block.kind !== 'prose') return [piece(block.kind, text)]
    return splitProse(text, max).map((part) => piece('prose', part))
  })
}

function headingPiece(node: Node): Piece {
  const title = node.section.headingPath.at(-1) ?? ''
  return piece('heading', `${'#'.repeat(Math.min(6, node.depth + 1))} ${title}`)
}

function subtreePieces(node: Node, max: number): Piece[] {
  return [
    ...ownPieces(node, max),
    ...node.children.flatMap((child) => [headingPiece(child), ...subtreePieces(child, max)]),
  ]
}

function buildTree(sections: readonly Section[]): Node {
  const root: Node = {
    section: { headingPath: [], anchor: '', blocks: [] },
    depth: 0,
    occurrence: 0,
    children: [],
  }
  const seen = new Map<string, number>()
  const stack: Node[] = [root]
  for (const section of sections) {
    if (section.headingPath.length === 0) {
      root.section.blocks.push(...section.blocks)
      continue
    }
    const key = JSON.stringify(section.headingPath)
    const occurrence = seen.get(key) ?? 0
    seen.set(key, occurrence + 1)
    const node: Node = { section, depth: section.headingPath.length, occurrence, children: [] }
    let parent = stack[stack.length - 1] ?? root
    while (stack.length > 1 && parent.depth >= node.depth) {
      stack.pop()
      parent = stack[stack.length - 1] ?? root
    }
    parent.children.push(node)
    stack.push(node)
  }
  return root
}

/** Chunk ID: doc path + heading path + occurrence + ordinal within the section (SPEC section 6). */
export function chunkId(
  docPath: string,
  headingPath: readonly string[],
  occurrence: number,
  ordinal: number,
): string {
  return sha256Hex(JSON.stringify([docPath, headingPath, occurrence, ordinal])).slice(0, 24)
}

/** Splits a parsed document into chunks, in document order. */
export function chunkDocument(
  docPath: string,
  doc: ParsedDoc,
  options: ChunkOptions = {},
): Chunk[] {
  const max = options.maxTokens ?? DEFAULT_MAX_TOKENS
  const chunks: Chunk[] = []

  const emit = (node: Node, ordinal: number, anchor: string, pieces: readonly Piece[]): void => {
    const headingPath = [...node.section.headingPath]
    let text = [doc.title, ...headingPath].join(' > ')
    const spans: [number, number][] = []
    let headingStart: number | undefined
    for (const p of pieces) {
      text += '\n\n'
      const start = text.length
      text += p.text
      if (p.kind === 'heading') {
        headingStart ??= start
        continue
      }
      spans.push([headingStart ?? start, text.length])
      headingStart = undefined
    }
    if (headingStart !== undefined) spans.push([headingStart, text.length])
    const blockTypes = [...new Set(pieces.filter((p) => p.kind !== 'heading').map((p) => p.kind))]
    chunks.push({
      id: chunkId(docPath, headingPath, node.occurrence, ordinal),
      docPath,
      ordinal: chunks.length,
      headingPath,
      anchor,
      blockTypes,
      text,
      textHash: sha256Hex(text),
      tokenCount: estimateTokens(text),
      spans,
    })
  }

  const chunkNode = (node: Node): void => {
    const all = subtreePieces(node, max)
    if (sumTokens(all) <= max) {
      if (hasContent(all)) emit(node, 0, node.section.anchor, all)
      return
    }

    let ordinal = 0
    let run: Item[] = []
    const flush = (): void => {
      for (const pack of packBalanced(run, (item) => item.tokens, max)) {
        // A pack that is exactly one child subtree is that child's own chunk.
        const only = pack.length === 1 ? pack[0]?.child : undefined
        if (only !== undefined) {
          const pieces = subtreePieces(only, max)
          if (hasContent(pieces)) emit(only, 0, only.section.anchor, pieces)
          continue
        }
        const pieces = pack.flatMap((item) => item.pieces)
        if (!hasContent(pieces)) continue
        emit(node, ordinal, pack[0]?.anchor ?? node.section.anchor, pieces)
        ordinal++
      }
      run = []
    }

    for (const p of ownPieces(node, max)) {
      run.push({ pieces: [p], tokens: p.tokens, anchor: node.section.anchor })
    }
    for (const child of node.children) {
      const pieces = [headingPiece(child), ...subtreePieces(child, max)]
      const tokens = sumTokens(pieces)
      if (tokens <= max) {
        run.push({ pieces, tokens, anchor: child.section.anchor, child })
        continue
      }
      flush()
      chunkNode(child)
    }
    flush()
  }

  chunkNode(buildTree(doc.sections))
  return chunks
}
