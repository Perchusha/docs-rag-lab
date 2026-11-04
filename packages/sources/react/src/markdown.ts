// react.dev MDX to sections and blocks. What becomes of each component is in
// ADR-0016, from a survey of every indexed page, and each label below is the one
// the site shows a reader. Prose blocks are slices of the original source with
// the component markup cut out, so inline code, links and tables stay exactly as
// written; code blocks are the fenced content byte-for-byte.
//
// A component the survey did not see is an error, not something to pass through:
// a new one could be a status box, and its markup would land in the index.
import {
  DEFAULT_MAX_TOKENS,
  estimateTokens,
  normalizeText,
  packBalanced,
  renderBlock,
  type Block,
  type Section,
} from '@docs-rag-lab/source-kit'
import type { Code, Heading, Nodes, Root, RootContent } from 'mdast'
import remarkFrontmatter from 'remark-frontmatter'
import remarkGfm from 'remark-gfm'
import remarkMdx from 'remark-mdx'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { parse as parseYaml } from 'yaml'

const processor = unified()
  .use(remarkParse)
  .use(remarkFrontmatter, ['yaml'])
  .use(remarkGfm)
  .use(remarkMdx)

/** Boxes the site labels, by the label a reader sees. */
const CALLOUTS: Readonly<Record<string, string>> = {
  DeepDive: 'Deep Dive',
  Deprecated: 'Deprecated',
  Experimental: 'Experimental Feature',
  Hint: 'Hint',
  Note: 'Note',
  Pitfall: 'Pitfall',
  RSC: 'React Server Components',
  Solution: 'Solution',
  Wip: 'Under Construction',
}

/** Layout only: what they hold is kept, and they leave no trace. */
const LAYOUT = new Set([
  'CodeDiagram',
  'ConsoleBlockMulti',
  'DiagramGroup',
  'FullWidth',
  'IllustrationBlock',
  'Intro',
  'LearnMore',
  'div',
])

/** Runnable examples: each file is a code block. */
const SANDPACKS = new Set(['Sandpack', 'SandpackWithHTMLOutput'])

/** Inline components that only style their text. */
const INLINE_LAYOUT = new Set(['CodeStep', 'Math', 'MathI', 'span'])

/** Inline badges, by the words the site shows. */
const BADGES: Readonly<Record<string, string>> = {
  CanaryBadge: 'Canary only',
  ExperimentalBadge: 'Experimental only',
}

/** Written on one line, these reach the parser as a paragraph holding one inline element. */
const FLOW_WRITTEN_INLINE = new Set(['Diagram', 'Hint'])

/**
 * The `<Recipes>` title is an h4 on the site, and the examples inside it are `####` too. Between
 * the h3 every one of them follows and those h4s, so the examples nest under it.
 */
const RECIPES_DEPTH = 3.5

interface HeadingItem {
  kind: 'heading'
  depth: number
  text: string
  anchor: string
}

type Item =
  | HeadingItem
  | { kind: 'block'; block: Block }
  /** A component with headings inside it: what follows it belongs to the heading before it. */
  | { kind: 'scope-start' }
  | { kind: 'scope-end' }

interface Page {
  path: string
  content: string
}

export interface MdxDoc {
  frontmatter: Record<string, unknown>
  sections: Section[]
}

function failure(page: Page, node: Nodes, message: string): Error {
  return new Error(`${page.path}:${String(node.position?.start.line ?? 0)}: ${message}`)
}

function offsetsOf(page: Page, node: Nodes): { start: number; end: number } {
  const start = node.position?.start.offset
  const end = node.position?.end.offset
  if (start === undefined || end === undefined) throw failure(page, node, 'node has no position')
  return { start, end }
}

function blockItem(block: Block): Item {
  return { kind: 'block', block }
}

type JsxElement = Extract<Nodes, { type: 'mdxJsxFlowElement' | 'mdxJsxTextElement' }>

function attributeOf(node: JsxElement, name: string): JsxElement['attributes'][number] | undefined {
  return node.attributes.find(
    (attribute) => attribute.type === 'mdxJsxAttribute' && attribute.name === name,
  )
}

function stringAttribute(node: JsxElement, name: string): string | undefined {
  const value = attributeOf(node, name)?.value
  return typeof value === 'string' ? value : undefined
}

/** The text of a heading: text and inline code, without markup or struck-out words. */
function plainText(node: Nodes): string {
  if (node.type === 'text' || node.type === 'inlineCode') return node.value
  if (node.type === 'mdxJsxTextElement' && node.name === 's') return ''
  if ('children' in node) return node.children.map((child) => plainText(child)).join('')
  return ''
}

/** Every heading ends in `{/*its-id*\/}`, which upstream's own check requires. */
function headingItem(page: Page, node: Heading): HeadingItem {
  const last = node.children.at(-1)
  const id =
    last?.type === 'mdxTextExpression' ? /^\/\*(\S+)\*\/$/.exec(last.value.trim())?.[1] : undefined
  if (id === undefined) throw failure(page, node, 'a heading has no {/*id*/}')
  const text = node.children
    .slice(0, -1)
    .map((child) => plainText(child))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
  return { kind: 'heading', depth: node.depth, text, anchor: id }
}

/** Language and file name, the parts of an info string that say what the code is. */
function codeBlock(node: Code): Block {
  const language = /^[A-Za-z]+/.exec(node.lang ?? '')?.[0] ?? ''
  const file = (node.meta ?? '')
    .split(/\s+/)
    .find((token) => /^(?:[\w.-]+\/)*[\w.-]+\.[a-z]+$/.test(token))
  const lang = file === undefined ? language : `${language} ${file}`.trim()
  return { kind: 'code', lang, code: node.value }
}

function isHiddenFile(node: Nodes): boolean {
  return node.type === 'code' && (node.meta ?? '').split(/\s+/).includes('hidden')
}

interface Edit {
  start: number
  end: number
  text: string
}

function expressionText(page: Page, node: Nodes, value: string): string {
  const expression = value.trim()
  if (/^\/\*[\s\S]*\*\/$/.test(expression)) return ''
  if (expression === "' '") return ' '
  throw failure(page, node, `an unexpected expression: {${expression}}`)
}

/** What has to change in a prose node's source so that no markup is left in it. */
function inlineEdits(page: Page, node: Nodes): Edit[] {
  const { start, end } = offsetsOf(page, node)
  switch (node.type) {
    case 'mdxFlowExpression':
    case 'mdxTextExpression':
      return [{ start, end, text: expressionText(page, node, node.value) }]
    case 'image':
      return [{ start, end, text: node.alt ?? '' }]
    case 'mdxJsxFlowElement':
      throw failure(page, node, `<${node.name ?? ''}> inside markdown`)
    case 'mdxJsxTextElement': {
      const name = node.name ?? ''
      // Struck out on the site: "camelCase ~all~ most of the things".
      if (name === 's') return [{ start, end, text: '' }]
      const badge = BADGES[name]
      if (badge !== undefined) return [{ start, end, text: badge }]
      if (!INLINE_LAYOUT.has(name)) throw failure(page, node, `an unknown component: <${name}>`)
      const first = node.children.at(0)
      const last = node.children.at(-1)
      if (first === undefined || last === undefined) return [{ start, end, text: '' }]
      return [
        { start, end: offsetsOf(page, first).start, text: '' },
        ...node.children.flatMap((child) => inlineEdits(page, child)),
        { start: offsetsOf(page, last).end, end, text: '' },
      ]
    }
    default:
      return 'children' in node ? node.children.flatMap((child) => inlineEdits(page, child)) : []
  }
}

function proseItems(page: Page, node: RootContent): Item[] {
  const { start, end } = offsetsOf(page, node)
  let text = ''
  let at = start
  for (const edit of inlineEdits(page, node).sort((a, b) => a.start - b.start)) {
    text += page.content.slice(at, edit.start) + edit.text
    at = edit.end
  }
  text = (text + page.content.slice(at, end)).trim()
  return text === '' ? [] : [blockItem({ kind: 'prose', text })]
}

/**
 * A callout is one piece to the chunker, which never splits one. So a long one, with a whole
 * example in it, is cut between its blocks here, and each part keeps the label.
 */
function calloutBlocks(variant: string, blocks: Block[]): Block[] {
  const tokensOf = (block: Block): number => estimateTokens(renderBlock(block))
  const whole: Block = { kind: 'callout', variant, blocks }
  if (tokensOf(whole) <= DEFAULT_MAX_TOKENS) return [whole]
  return packBalanced(blocks, tokensOf, DEFAULT_MAX_TOKENS).map((part) => ({
    kind: 'callout',
    variant,
    blocks: part,
  }))
}

function scoped(items: Item[]): Item[] {
  if (!items.some((item) => item.kind === 'heading')) return items
  return [{ kind: 'scope-start' }, ...items, { kind: 'scope-end' }]
}

/** Runs of blocks become callouts. A heading inside stays a heading, since it has an anchor. */
function calloutItems(variant: string, inner: readonly Item[]): Item[] {
  const items: Item[] = []
  let run: Block[] = []
  const flush = (): void => {
    if (run.length > 0) items.push(...calloutBlocks(variant, run).map(blockItem))
    run = []
  }
  for (const item of inner) {
    if (item.kind === 'block') {
      run.push(item.block)
      continue
    }
    flush()
    items.push(item)
  }
  flush()
  return scoped(items)
}

function childItems(page: Page, node: JsxElement): Item[] {
  return node.children.flatMap((child) => flowItems(page, child))
}

/** A picture is its alt text, which says what it shows, and its caption. */
function figureItems(node: JsxElement, variant: string, caption: Item[]): Item[] {
  const alt = stringAttribute(node, 'alt')
  const description: Item[] =
    alt === undefined || alt.trim() === '' ? [] : [blockItem({ kind: 'prose', text: alt.trim() })]
  return calloutItems(variant, [...description, ...caption])
}

function componentItems(page: Page, node: JsxElement): Item[] {
  const name = node.name ?? ''
  const callout = CALLOUTS[name]
  if (callout !== undefined) return calloutItems(callout, childItems(page, node))
  if (LAYOUT.has(name)) return childItems(page, node)
  if (SANDPACKS.has(name)) {
    return node.children.flatMap((child) => (isHiddenFile(child) ? [] : flowItems(page, child)))
  }
  switch (name) {
    // A table of contents the site builds from the headings.
    case 'InlineToc':
      return []
    case 'YouWillLearn':
      return calloutItems(
        attributeOf(node, 'isChapter') === undefined ? 'You will learn' : 'In this chapter',
        childItems(page, node),
      )
    // An h2 on the site, with this text and this anchor.
    case 'Recap':
      return [
        { kind: 'heading', depth: 2, text: 'Recap', anchor: 'recap' },
        ...childItems(page, node),
      ]
    case 'Challenges':
      return [
        { kind: 'heading', depth: 2, text: 'Try out some challenges', anchor: 'challenges' },
        ...childItems(page, node),
      ]
    case 'Recipes':
      return scoped([
        {
          kind: 'heading',
          depth: RECIPES_DEPTH,
          text: stringAttribute(node, 'titleText') ?? 'Try out some examples',
          anchor: stringAttribute(node, 'titleId') ?? 'examples',
        },
        ...childItems(page, node),
      ])
    case 'TerminalBlock': {
      const first = node.children.at(0)
      const last = node.children.at(-1)
      if (first === undefined || last === undefined) return []
      const start = offsetsOf(page, first).start
      const code = page.content.slice(start, offsetsOf(page, last).end)
      return [blockItem({ kind: 'code', lang: 'bash', code })]
    }
    case 'ConsoleBlock':
    case 'ConsoleLogLine':
      return calloutItems(
        `Console ${stringAttribute(node, 'level') ?? 'log'}`,
        childItems(page, node),
      )
    case 'Diagram':
      return figureItems(node, 'Diagram', childItems(page, node))
    case 'Illustration': {
      const caption = stringAttribute(node, 'caption')
      return figureItems(
        node,
        'Illustration',
        caption === undefined ? [] : [blockItem({ kind: 'prose', text: caption })],
      )
    }
    case 'img': {
      // The site shows one picture of a light and dark pair, and they have the same alt text.
      if (stringAttribute(node, 'className')?.includes('dark-image') === true) return []
      const alt = stringAttribute(node, 'alt')
      return alt === undefined ? [] : [blockItem({ kind: 'prose', text: alt })]
    }
    default:
      throw failure(page, node, `an unknown component: <${name}>`)
  }
}

/** The items of a block-level node. */
function flowItems(page: Page, node: RootContent): Item[] {
  switch (node.type) {
    case 'yaml':
    case 'thematicBreak':
    case 'definition':
    case 'mdxjsEsm':
      return []
    case 'mdxFlowExpression':
      if (expressionText(page, node, node.value) !== '') {
        throw failure(page, node, 'a block expression that is not a comment')
      }
      return []
    case 'heading':
      return [headingItem(page, node)]
    case 'code':
      return [blockItem(codeBlock(node))]
    case 'mdxJsxFlowElement':
      return componentItems(page, node)
    case 'paragraph': {
      const only = node.children.length === 1 ? node.children[0] : undefined
      if (only?.type === 'mdxJsxTextElement' && FLOW_WRITTEN_INLINE.has(only.name ?? '')) {
        return componentItems(page, only)
      }
      return proseItems(page, node)
    }
    default:
      return proseItems(page, node)
  }
}

function sectionsOf(items: readonly Item[]): Section[] {
  const sections: Section[] = [{ headingPath: [], anchor: '', blocks: [] }]
  let open: HeadingItem[] = []
  const scopes: HeadingItem[][] = []
  // Set after a component with headings inside: the next block goes back under the heading before it.
  let reopen = false

  const startSection = (anchor: string): void => {
    sections.push({ headingPath: open.map((heading) => heading.text), anchor, blocks: [] })
    reopen = false
  }

  for (const item of items) {
    switch (item.kind) {
      case 'block':
        if (reopen) startSection(open.at(-1)?.anchor ?? '')
        sections.at(-1)?.blocks.push(item.block)
        break
      case 'heading':
        while ((open.at(-1)?.depth ?? 0) >= item.depth) open.pop()
        open.push(item)
        startSection(item.anchor)
        break
      case 'scope-start':
        scopes.push([...open])
        break
      case 'scope-end':
        open = scopes.pop() ?? []
        reopen = true
        break
    }
  }
  return sections.filter((section, index) => index > 0 || section.blocks.length > 0)
}

function frontmatterOf(root: Root): Record<string, unknown> {
  const node = root.children.find((child) => child.type === 'yaml')
  if (node === undefined) return {}
  const value: unknown = parseYaml(node.value)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

export function parseMdx(path: string, source: string): MdxDoc {
  const content = normalizeText(source)
  const root = processor.parse(content)
  const page: Page = { path, content }
  return {
    frontmatter: frontmatterOf(root),
    sections: sectionsOf(root.children.flatMap((node) => flowItems(page, node))),
  }
}
