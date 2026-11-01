import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { answerFixture, documentFixture, traces } from '../fixtures.ts'
import { fusionRows } from '../lib/fusion.ts'
import { replayTransport } from '../lib/replay.ts'
import { FUSION_ROWS } from './FusionView.tsx'
import { Inspector, type InspectorProps, type InspectorTab } from './Inspector.tsx'

const transport = replayTransport({ documents: [documentFixture], delayMs: 20 })

/** The inspector with its selection and tab kept in state, as DocsAssistant keeps them. */
function Harness(props: Pick<InspectorProps, 'trace' | 'citations'>) {
  const [selected, setSelected] = useState<string | undefined>(undefined)
  const [tab, setTab] = useState<InspectorTab | undefined>(undefined)
  return (
    <Inspector
      {...props}
      selectedChunkId={selected}
      onSelectChunk={setSelected}
      tab={tab}
      onTabChange={setTab}
      transport={transport}
    />
  )
}

const meta = {
  title: 'Inspector/Inspector',
  component: Harness,
  args: { trace: traces.satisfies, citations: answerFixture.citations },
} satisfies Meta<typeof Harness>

export default meta
type Story = StoryObj<typeof meta>

function headerOf(root: HTMLElement, name: string): HTMLElement {
  const header = within(root).getByRole('button', { name }).closest('th')
  if (header === null) throw new Error(`no header for ${name}`)
  return header
}

function firstRowCells(root: HTMLElement): HTMLElement[] {
  const rows = within(root).getAllByRole('row')
  // Row 0 is the header row.
  return within(rows[1] ?? document.body).getAllByRole('cell')
}

/** `satisfies`: BM25 counts it twice, and the vector top hit falls to 3. */
export const DoubleCounting: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/BM25 counts twice\./)).toBeVisible()
    await expect(canvas.getByText(/for 6 of the top 8 chunks/)).toBeVisible()
    const twice = fusionRows(traces.satisfies)
      .slice(0, FUSION_ROWS)
      .filter((r) => r.bm25Twice)
    await expect(canvas.getAllByText('BM25 x2')).toHaveLength(twice.length)
    await expect(canvas.getByRole('cell', { name: 'The top 8 go to the answer' })).toBeVisible()
    await expect(canvas.getByRole('table')).toBeVisible()
    await expect(canvas.getAllByRole('columnheader')).toHaveLength(8)
    await expect(canvas.getByText('down 2 from vector')).toBeInTheDocument()
  },
}

/** Sorting with the keyboard only: Enter and Space on the header buttons. */
export const KeyboardSorting: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(headerOf(canvasElement, 'Fused')).toHaveAttribute('aria-sort', 'ascending')

    canvas.getByRole('button', { name: 'Vector' }).focus()
    await userEvent.keyboard('{Enter}')
    await expect(headerOf(canvasElement, 'Vector')).toHaveAttribute('aria-sort', 'ascending')
    await expect(headerOf(canvasElement, 'Fused')).not.toHaveAttribute('aria-sort')
    // The vector top hit, fused rank 3, now leads.
    await expect(firstRowCells(canvasElement)[0]).toHaveTextContent('3')
    await expect(canvas.queryByRole('cell', { name: 'The top 8 go to the answer' })).toBeNull()

    await userEvent.keyboard(' ')
    await expect(headerOf(canvasElement, 'Vector')).toHaveAttribute('aria-sort', 'descending')
    await expect(canvas.getByRole('button', { name: 'Vector' })).toHaveFocus()

    await userEvent.tab()
    await expect(canvas.getByRole('button', { name: 'Keyword' })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect(headerOf(canvasElement, 'Keyword')).toHaveAttribute('aria-sort', 'ascending')
    // Cells: fused, delta, chunk, vector, keyword, exact, RRF score, contributions.
    await expect(firstRowCells(canvasElement)[4]).toHaveTextContent(/^1, score /)
  },
}

/** The tabs: one tab stop, arrow keys with wrapping, Home and End. */
export const KeyboardTabs: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const tab = (name: RegExp) => canvas.getByRole('tab', { name })
    const tabs = canvas.getAllByRole('tab')
    await expect(tabs.filter((t) => t.tabIndex === 0)).toEqual([tab(/Fusion/)])

    tab(/Fusion/).focus()
    await userEvent.keyboard('{ArrowRight}')
    await expect(tab(/Lists/)).toHaveFocus()
    await expect(tab(/Lists/)).toHaveAttribute('aria-selected', 'true')
    await expect(canvas.getByRole('tabpanel')).toHaveAccessibleName('Lists')
    await expect(canvas.getByRole('heading', { name: 'Exact' })).toBeVisible()

    await userEvent.keyboard('{End}')
    await expect(tab(/Document/)).toHaveFocus()
    await userEvent.keyboard('{ArrowRight}')
    await expect(tab(/Fusion/)).toHaveFocus()
    await userEvent.keyboard('{ArrowLeft}')
    await expect(tab(/Document/)).toHaveFocus()
    await userEvent.keyboard('{Home}')
    await expect(tab(/Fusion/)).toHaveFocus()
    await expect(tab(/Fusion/)).toHaveAttribute('aria-selected', 'true')

    // Tab leaves the tab list for the panel: the other tabs are not tab stops.
    await userEvent.tab()
    await expect(canvas.getByRole('tabpanel')).toHaveFocus()
    await expect(canvas.getAllByRole('tabpanel')).toHaveLength(1)
  },
}

/** A chunk picked in the fusion table opens on the Document tab, among its neighbours. */
export const ChunkBoundaries: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const pick = canvas.getAllByRole('button', { name: /TypeScript 4\.9 > The satisfies Operator/ })
    await userEvent.click(pick[0] ?? canvasElement)
    // Selected is said in text, not only by the row's background.
    await expect(pick[0]).toHaveAttribute('aria-current', 'true')
    await expect(pick[0]).toHaveTextContent(/selected$/)

    await userEvent.click(canvas.getByRole('tab', { name: 'Document' }))
    const chunks = await canvas.findByRole('list', { name: 'Chunks of TypeScript 4.9' })
    await expect(within(chunks).getAllByRole('listitem')).toHaveLength(11)
    await expect(within(chunks).getByText('selected')).toBeVisible()
    await expect(within(chunks).getByText('candidate #3')).toBeVisible()
  },
}

export const Lists: Story = {
  args: { trace: traces.ts2345 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('tab', { name: 'Lists' }))
    await expect(canvas.getByText('"TS2345" OR "2345"')).toBeVisible()
  },
}

export const Context: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('tab', { name: 'Context (8)' }))
    const list = canvas.getByRole('list', { name: 'The 8 chunks sent to Claude' })
    await expect(within(list).getAllByRole('listitem')).toHaveLength(8)
    await expect(within(list).getByText('cited as [1]')).toBeVisible()
  },
}

/** ts-0004: a Russian question; the query terms are Russian, the exact tokens are not. */
export const CrossLingual: Story = {
  args: { trace: traces.ts0004, citations: [] },
}

/** Vector search only: no fusion, so the inspector opens on the lists. */
export const VectorOnly: Story = {
  args: { trace: traces.satisfiesVector, citations: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('tab', { name: 'Lists' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await userEvent.click(canvas.getByRole('tab', { name: 'Fusion' }))
    await waitFor(() => expect(canvas.getByText(/nothing was fused/)).toBeVisible())
  },
}

export const Empty: Story = {
  args: { trace: undefined, citations: [] },
}
