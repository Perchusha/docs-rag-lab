// TypeScript-Website markdown to sections and blocks. Prose blocks are slices
// of the original source, so inline code, links and tables stay exactly as
// written; code blocks are the fenced content byte-for-byte (no twoslash
// compile until M7).
import { normalizeText, type Block, type Section } from '@docs-rag-lab/source-kit'
import GithubSlugger from 'github-slugger'
import type { Nodes, Root, RootContent } from 'mdast'
import remarkFrontmatter from 'remark-frontmatter'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { parse as parseYaml } from 'yaml'

import { htmlToText, isHtmlComment } from './html.ts'

const processor = unified().use(remarkParse).use(remarkFrontmatter, ['yaml']).use(remarkGfm)

export interface MarkdownDoc {
  frontmatter: Record<string, unknown>
  sections: Section[]
  /** Every fenced or indented code block, in order. */
  code: string[]
}

/** The text of a node: text and inline code values, without markup. */
export function plainText(node: Nodes): string {
  if ('value' in node && (node.type === 'text' || node.type === 'inlineCode')) return node.value
  if ('children' in node) return node.children.map((child) => plainText(child)).join('')
  return ''
}

function sliceOf(content: string, node: RootContent): string {
  const start = node.position?.start.offset
  const end = node.position?.end.offset
  if (start === undefined || end === undefined) throw new Error(`${node.type} node has no position`)
  return content.slice(start, end)
}

function frontmatterOf(root: Root): Record<string, unknown> {
  const node = root.children.find((child) => child.type === 'yaml')
  if (node === undefined || !('value' in node)) return {}
  const value: unknown = parseYaml(node.value)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

/** The block for a top-level node, or undefined for nodes that carry no content. */
function blockOf(content: string, node: RootContent): Block | undefined {
  switch (node.type) {
    case 'yaml':
    case 'thematicBreak':
    case 'definition':
      return undefined
    case 'code':
      return { kind: 'code', lang: node.lang ?? '', code: node.value }
    case 'html': {
      if (isHtmlComment(node.value)) return undefined
      const text = htmlToText(node.value)
      return text === '' ? undefined : { kind: 'prose', text }
    }
    default: {
      const text = sliceOf(content, node).trim()
      return text === '' ? undefined : { kind: 'prose', text }
    }
  }
}

function collectCode(node: Nodes, into: string[]): void {
  if (node.type === 'code') into.push(node.value)
  if ('children' in node) for (const child of node.children) collectCode(child, into)
}

/**
 * Parses a markdown file. Each heading starts a section whose path holds the
 * enclosing headings by level; anchors follow github-slugger, as on
 * typescriptlang.org (one slugger per page, so duplicates get -1, -2, ...).
 */
export function parseMarkdown(source: string, options: { anchors: boolean }): MarkdownDoc {
  const content = normalizeText(source)
  const root = processor.parse(content)
  const slugger = new GithubSlugger()
  const sections: Section[] = [{ headingPath: [], anchor: '', blocks: [] }]
  const stack: { depth: number; text: string }[] = []

  for (const node of root.children) {
    if (node.type === 'heading') {
      const text = plainText(node).trim()
      while (stack.length > 0 && (stack[stack.length - 1]?.depth ?? 0) >= node.depth) stack.pop()
      stack.push({ depth: node.depth, text })
      const anchor = slugger.slug(text)
      sections.push({
        headingPath: stack.map((entry) => entry.text),
        anchor: options.anchors ? anchor : '',
        blocks: [],
      })
      continue
    }
    const block = blockOf(content, node)
    if (block !== undefined) sections[sections.length - 1]?.blocks.push(block)
  }

  const code: string[] = []
  collectCode(root, code)
  return {
    frontmatter: frontmatterOf(root),
    sections: sections.filter((section, index) => index > 0 || section.blocks.length > 0),
    code,
  }
}
