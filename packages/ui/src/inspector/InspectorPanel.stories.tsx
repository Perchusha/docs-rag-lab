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
