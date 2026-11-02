// Claude's answer is markdown, with GFM for its tables. It is rendered safely
// (ADR-0008):
// - no raw HTML: there is no rehype-raw, so HTML in the answer shows as text;
// - react-markdown's default URL sanitizing stays, so javascript: and other
//   unsafe URLs are dropped;
// - only http(s) links render as links, opening in a new tab with
//   rel="noopener noreferrer"; images render as their alt text, so an answer
//   cannot load anything from elsewhere; GFM task lists render as text, so an
//   answer adds no form controls.
// Citation markers arrive as links to #cite-<n> (lib/answer.ts) and become
// buttons that show the cited chunk in the inspector. Tables and code blocks
// scroll inside their own focusable box, so the page never has to.
import type { Citation } from '@docs-rag-lab/contracts'
import { createContext, useContext, useMemo, type ReactNode } from 'react'
import Markdown, { type Components, type Options } from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { citationNumber } from '../lib/answer.ts'
import common from '../lib/common.module.css'
import { ScrollRegion } from '../lib/ScrollRegion.tsx'
import styles from './AnswerMarkdown.module.css'

export interface AnswerMarkdownProps {
  markdown: string
  /** The answer's citations; an excerpt from the docs has none. */
  citations?: readonly Citation[] | undefined
  onCitation?: ((citation: Citation, trigger: HTMLElement) => void) | undefined
  /**
   * For an excerpt quoted inside the page: its headings render as bold text, so
   * they do not become headings of the page.
   */
  quoted?: boolean | undefined
}

const QUOTED_HEADING = ({ children }: { children?: ReactNode }) => (
  <p>
    <strong>{children}</strong>
  </p>
)
const NO_CITATIONS: readonly Citation[] = []

// Only ~~two tildes~~ strike through: version ranges like ~5.0 are common here.
const REMARK_PLUGINS: Options['remarkPlugins'] = [[remarkGfm, { singleTilde: false }]]

function isWebUrl(href: string | undefined): href is string {
  return href !== undefined && /^https?:\/\//i.test(href)
}

/** The parts of a syntax tree node that the table label reads. */
interface TreeNode {
  type: string
  tagName?: string
  value?: string
  children?: TreeNode[]
}

function textOf(node: TreeNode): string {
  return node.type === 'text' ? (node.value ?? '') : (node.children ?? []).map(textOf).join('')
}

function firstRow(node: TreeNode): TreeNode | undefined {
  if (node.tagName === 'tr') return node
  for (const child of node.children ?? []) {
    const row = firstRow(child)
    if (row !== undefined) return row
  }
  return undefined
}

/** A table's name, from its column headers. */
function tableLabel(table: TreeNode | undefined): string {
  const row = table === undefined ? undefined : firstRow(table)
  const headers = (row?.children ?? [])
    .filter((cell) => cell.tagName === 'th')
    .map((cell) => textOf(cell).trim())
    .filter((text) => text !== '')
  return headers.length === 0 ? 'Table' : `Table: ${headers.join(', ')}`
}

export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className={common.link} href={href} target="_blank" rel="noopener noreferrer">
      {children}
      <span className={common.srOnly}> (opens in a new tab)</span>
    </a>
  )
}

/**
 * What a citation marker needs, through context and not in the component map: a
 * new map would remount the whole answer, and a focused citation with it.
 */
const CitationContext = createContext<{
  citations: readonly Citation[]
  onCitation: AnswerMarkdownProps['onCitation']
}>({ citations: [], onCitation: undefined })

function MarkdownLink({ href, children }: { href?: string | undefined; children?: ReactNode }) {
  const { citations, onCitation } = useContext(CitationContext)
  const n = citationNumber(href)
  if (n !== undefined) {
    const citation = citations.find((c) => c.number === n)
    if (citation === undefined) return <span className={styles.marker}>[{n}]</span>
    return (
      <button
        type="button"
        className={styles.citation}
        aria-label={`Source ${String(n)}: ${citation.title}. Show it in the inspector`}
        title={citation.title}
        onClick={(event) => onCitation?.(citation, event.currentTarget)}
      >
        {n}
      </button>
    )
  }
  return isWebUrl(href) ? <ExternalLink href={href}>{children}</ExternalLink> : children
}

const COMPONENTS: Components = {
  a: MarkdownLink,
  img: ({ alt }) => (alt === undefined || alt === '' ? null : <span>{alt}</span>),
  input: ({ checked }) => <span>{checked === true ? '[x] ' : '[ ] '}</span>,
  table: ({ node, children }) => (
    <ScrollRegion label={tableLabel(node)} className={styles.block}>
      <table>{children}</table>
    </ScrollRegion>
  ),
  // A comparison table's empty corner is not a header: it heads nothing,
  // and a header with no text is announced as a blank.
  th: ({ node, children, style }) =>
    node !== undefined && textOf(node).trim() === '' ? (
      <td style={style} />
    ) : (
      <th style={style}>{children}</th>
    ),
  pre: ({ children }) => (
    <ScrollRegion label="Code example" className={styles.code}>
      <pre>{children}</pre>
    </ScrollRegion>
  ),
}

const QUOTED_COMPONENTS: Components = {
  ...COMPONENTS,
  h1: QUOTED_HEADING,
  h2: QUOTED_HEADING,
  h3: QUOTED_HEADING,
  h4: QUOTED_HEADING,
  h5: QUOTED_HEADING,
  h6: QUOTED_HEADING,
}

export function AnswerMarkdown({
  markdown,
  citations = NO_CITATIONS,
  onCitation,
  quoted = false,
}: AnswerMarkdownProps) {
  const context = useMemo(() => ({ citations, onCitation }), [citations, onCitation])
  // Parsing is the costly part, and the page renders on every delta of the newest
  // answer. Earlier answers keep their text, so they do not parse again.
  const content = useMemo(
    () => (
      <Markdown remarkPlugins={REMARK_PLUGINS} components={quoted ? QUOTED_COMPONENTS : COMPONENTS}>
        {markdown}
      </Markdown>
    ),
    [markdown, quoted],
  )
  return (
    <div className={styles.markdown}>
      <CitationContext.Provider value={context}>{content}</CitationContext.Provider>
    </div>
  )
}
