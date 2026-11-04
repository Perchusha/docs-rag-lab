import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { answerFixture, traces } from '../fixtures.ts'
import { replayTransport } from '../lib/replay.ts'
import { InspectorPanel } from './InspectorPanel.tsx'

const meta = {
  title: 'Inspector/InspectorPanel',
  component: InspectorPanel,
  args: {
    trace: traces.satisfies,
    answerTrace: traces.satisfies,
    usage: answerFixture.usage,
    citations: answerFixture.citations,
    searching: false,
    error: undefined,
    strategy: 'hybrid',
    onStrategyChange: fn(),
    query: 'In which version did `satisfies` appear?',
    onQueryChange: fn(),
    onSearch: fn(),
    selectedChunkId: undefined,
    onSelectChunk: fn(),
    tab: undefined,
    onTabChange: fn(),
    reveal: undefined,
    onRevealed: fn(),
    focusHeading: false,
    onHeadingFocused: fn(),
    onClose: fn(),
    transport: replayTransport({}),
  },
} satisfies Meta<typeof InspectorPanel>

export default meta
type Story = StoryObj<typeof meta>

const asked = {
  trace: undefined,
  running: false,
  error: undefined,
  onCompare: fn(),
  onStop: fn(),
}

/** Before it is asked for: what it costs, and that it changes nothing else. */
export const RerankerNotAsked: Story = {
  args: { rerank: asked, tab: 'reranker' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText('What the reranker would change.').parentElement,
    ).toHaveTextContent(
      'One Voyage call on the free trial, up to about a minute, with no Claude call. It changes neither this answer nor your next question.',
    )
    await expect(canvas.queryByRole('table')).toBeNull()
    // It is a comparison and no method, so the toggle does not offer it.
    await expect(
      canvas.getAllByRole('radio').map((radio) => radio.parentElement?.textContent),
    ).toEqual(['Hybrid', 'Vector'])
    asked.onCompare.mockClear()
    await userEvent.click(canvas.getByRole('button', { name: 'Compare with rerank' }))
    await expect(asked.onCompare).toHaveBeenCalledOnce()
  },
}

export const RerankerWaiting: Story = {
  args: { rerank: { ...asked, running: true }, tab: 'reranker' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const statuses = canvas.getAllByRole('status').map((status) => status.textContent)
    await expect(statuses).toContain(
      'Reranking, with no Claude call. On the free trial this can take a minute.',
    )
    await expect(canvas.queryByRole('button', { name: 'Compare with rerank' })).toBeNull()
    asked.onStop.mockClear()
    await userEvent.click(canvas.getByRole('button', { name: 'Stop waiting' }))
    await expect(asked.onStop).toHaveBeenCalledOnce()
  },
}

/** A real trace of ts-0033: where each chunk would go, and what crosses the line. */
export const RerankerResult: Story = {
  args: { rerank: { ...asked, trace: traces.satisfiesRerank }, tab: 'reranker' },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText(
        '2 chunks would come into the top 8, and 2 would leave. The answer above stays as it is.',
      ),
    ).toBeVisible()
    const rows = within(canvas.getByRole('table', { name: 'What the reranker would change' }))
      .getAllByRole('row')
      .slice(1)
    // Twenty scored, and the line that says what goes to an answer.
    await expect(rows).toHaveLength(21)
    await expect(rows[1]).toHaveTextContent(/^24/)
    await expect(rows[8]).toHaveTextContent('The top 8 go to an answer')
    await expect(rows[6]).toHaveTextContent('came in')
    await expect(rows[9]).not.toHaveTextContent('came in')
    await expect(rows[10]).toHaveTextContent('left')
    await expect(
      canvas.getByText(/scored the fused top 20 in one call, from the cache/),
    ).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Compare with rerank' })).toBeNull()
    // Selecting a chunk works as on the other tabs.
    const chunk = within(rows[0] ?? document.body).getByRole('button')
    await userEvent.click(chunk)
    await expect(args.onSelectChunk).toHaveBeenCalled()
  },
}

export const RerankerFailed: Story = {
  args: { rerank: { ...asked, error: 'Voyage did not take this rerank call.' }, tab: 'reranker' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const statuses = canvas.getAllByRole('status').map((status) => status.textContent)
    await expect(statuses).toContain('Error: Voyage did not take this rerank call.')
    await expect(canvas.getByRole('button', { name: 'Compare with rerank' })).toBeVisible()
  },
}

/** The reranker reads the fused ranking, which a vector search does not have. */
export const RerankerOnVector: Story = {
  args: {
    trace: traces.satisfiesVector,
    answerTrace: traces.satisfiesVector,
    strategy: 'vector',
    rerank: asked,
    tab: 'reranker',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/compare from a hybrid search/)).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Compare with rerank' })).toBeNull()
  },
}

/** A host that gives no way to ask has no such tab. */
export const NoRerankerTab: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('tab', { name: 'Reranker' })).toBeNull()
  },
}

/** The answer's own trace. The jargon lives here: the method, the tokens and the cost. */
export const AnswerTrace: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('status')).toHaveTextContent(
      'Changing the method or searching again makes no Claude call.',
    )
    await expect(canvas.getByText(/^The answer used .*About \$/)).toBeVisible()
    await expect(canvas.getByRole('radio', { name: 'Hybrid' })).toBeChecked()
    await expect(canvas.getByRole('textbox', { name: 'Search for' })).toHaveValue(args.query)
    // The search field shows the question, so the facts do not repeat it.
    await expect(canvas.queryByText('Question')).toBeNull()
    await expect(canvas.queryByRole('group', { name: 'Doc types' })).toBeNull()
  },
}

/** The arrow keys change the method, as native radios do. */
export const ToggleByKeyboard: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    canvas.getByRole('radio', { name: 'Hybrid' }).focus()
    await userEvent.keyboard('{ArrowRight}')
    await expect(args.onStrategyChange).toHaveBeenLastCalledWith('vector')
  },
}

/** A fresh search says what it is, next to the answer it came after. */
export const FreshSearch: Story = {
  args: { trace: traces.satisfiesVector, strategy: 'vector' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('status')).toHaveTextContent(
      'Showing a fresh vector search, with no Claude call. The answer came from hybrid search.',
    )
    await expect(canvas.getByRole('radio', { name: 'Vector' })).toBeChecked()
    await expect(canvas.getByRole('tab', { name: 'Lists' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  },
}

/** A search can run before the answer has a trace of its own. */
export const FreshSearchWithoutAnswerTrace: Story = {
  args: { trace: traces.satisfiesVector, answerTrace: undefined, strategy: 'vector' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('status')).toHaveTextContent(
      /^Showing a fresh vector search, with no Claude call\.$/,
    )
  },
}

/** The toggle sets the next question's method too, and an earlier answer keeps its own. */
export const NextQuestionDiffers: Story = {
  args: { strategy: 'vector' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('status')).toHaveTextContent(
      'The answer came from hybrid search. New questions will use vector search.',
    )
  },
}

export const Searching: Story = {
  args: { searching: true },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('status')).toHaveTextContent(
      'Searching the docs, with no Claude call.',
    )
  },
}

export const SearchFailed: Story = {
  args: { error: 'Voyage is overloaded' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // The trace below stays, and the line says it is not the new search's.
    await expect(canvas.getByRole('status')).toHaveTextContent(
      'Error: Voyage is overloaded. The trace below is still the earlier one.',
    )
    await expect(canvas.getByRole('tablist')).toBeVisible()
  },
}

/** A question still searching has no trace to show yet. */
export const NoTraceYet: Story = {
  args: { trace: undefined, answerTrace: undefined, usage: undefined, citations: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/no retrieval trace/)).toBeVisible()
    await expect(canvas.queryByRole('tablist')).toBeNull()
    // Nothing to say yet, and in the accessibility tree already.
    await expect(canvas.getByRole('status')).toHaveTextContent(/^$/)
    await expect(canvas.getByRole('button', { name: 'Search only' })).toBeVisible()
  },
}

/** An empty field searches nothing, and focus goes back to it. */
export const EmptySearch: Story = {
  args: { query: '   ' },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Search only' }))
    await expect(args.onSearch).not.toHaveBeenCalled()
    await expect(canvas.getByRole('textbox', { name: 'Search for' })).toHaveFocus()
  },
}

/** Close and Esc ask to close; the owner returns focus. */
export const Closing: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Close the inspector' }))
    await expect(args.onClose).toHaveBeenCalledTimes(1)
    canvas.getByRole('textbox', { name: 'Search for' }).focus()
    await userEvent.keyboard('{Escape}')
    await expect(args.onClose).toHaveBeenCalledTimes(2)
  },
}

/** Moves focus once when asked to. */
export const FocusHeading: Story = {
  args: { focusHeading: true },
  play: async ({ args, canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('heading', { level: 2, name: 'Retrieval inspector' }),
    ).toHaveFocus()
    await expect(args.onHeadingFocused).toHaveBeenCalledOnce()
  },
}
