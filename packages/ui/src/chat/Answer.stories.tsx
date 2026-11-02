import { NO_CONTEXT, type AnswerEvent } from '@docs-rag-lab/contracts'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { answerFixture, tableAnswerFixture, traces } from '../fixtures.ts'
import {
  assistantReducer,
  initialState,
  type AssistantAction,
  type AssistantState,
} from '../lib/assistant.ts'
import { Answer } from './Answer.tsx'

const question = 'In which version did `satisfies` appear?'

function stateAfter(events: readonly AnswerEvent[], extra: AssistantAction[] = []): AssistantState {
  const actions: AssistantAction[] = [
    { type: 'start', mode: 'ask', question },
    ...events.map((event) => ({ type: 'event', event }) as const),
    ...extra,
  ]
  return actions.reduce(assistantReducer, initialState)
}

const meta = {
  title: 'Chat/Answer',
  component: Answer,
  args: { state: stateAfter(answerFixture.events), onCitation: fn() },
} satisfies Meta<typeof Answer>

export default meta
type Story = StoryObj<typeof meta>

export const Done: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const citations = canvas.getAllByRole('button', {
      name: 'Source 1: TypeScript 5.0 > @satisfies Support in JSDoc. Show it in the inspector',
    })
    await expect(citations).toHaveLength(2)
    await expect(canvas.getByRole('article')).toHaveAttribute('aria-busy', 'false')
    await expect(canvas.getByText(/claude-sonnet-5-5 7,927 in, 124 out/)).toBeVisible()

    citations[1]?.focus()
    await userEvent.keyboard('{Enter}')
    await expect(args.onCitation).toHaveBeenCalledWith(answerFixture.citations[0])
  },
}

/** A recorded answer with a table with cited cells, then two code blocks. */
export const WithTable: Story = {
  args: { state: stateAfter(tableAnswerFixture.events) },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const table = canvas.getByRole('table')
    await expect(within(table).getAllByRole('columnheader')).toHaveLength(2)
    await expect(within(table).getAllByRole('row')).toHaveLength(6)

    // The table and each code block scroll in a box the keyboard can reach.
    const box = canvas.getByRole('group', { name: 'Table: any, unknown' })
    await expect(box).toContainElement(table)
    await expect(box).toHaveAttribute('tabindex', '0')
    await expect(canvas.getAllByRole('group', { name: 'Code example' })).toHaveLength(2)

    // A citation in a cell works like any other.
    const [citation] = within(table).getAllByRole('button', { name: /^Source 2: / })
    await userEvent.click(citation ?? canvasElement)
    await expect(args.onCitation).toHaveBeenCalledWith(tableAnswerFixture.citations[1])
  },
}

/** Halfway through the stream: one cited block in, the progress dots showing. */
export const Streaming: Story = {
  args: { state: stateAfter(answerFixture.events.slice(0, 9)) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('article')).toHaveAttribute('aria-busy', 'true')
    await expect(canvas.queryByRole('status')).toBeNull()
    await expect(canvas.getAllByRole('button')).toHaveLength(1)
  },
}

export const SearchOnly: Story = {
  args: {
    state: [
      { type: 'start', mode: 'search', question },
      { type: 'searched', trace: traces.satisfies },
    ].reduce<AssistantState>(
      (state, action) => assistantReducer(state, action as AssistantAction),
      initialState,
    ),
  },
}

export const NoContext: Story = {
  args: {
    state: stateAfter([
      { type: 'trace', trace: { ...traces.satisfies, context: [] } },
      { type: 'done', stopReason: NO_CONTEXT, usage: answerFixture.usage },
    ]),
  },
}

export const Stopped: Story = {
  args: { state: stateAfter(answerFixture.events.slice(0, 6), [{ type: 'stopped' }]) },
}

export const Failed: Story = {
  args: {
    state: stateAfter(answerFixture.events.slice(0, 3), [
      { type: 'failed', message: 'Overloaded: the API is busy, try again shortly' },
    ]),
  },
}
