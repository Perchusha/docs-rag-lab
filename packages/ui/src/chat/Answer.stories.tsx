import { NO_CONTEXT, type AnswerEvent } from '@docs-rag-lab/contracts'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import {
  agenticFixture,
  answerFixture,
  citationAfterCodeFixture,
  tableAnswerFixture,
  traces,
} from '../fixtures.ts'
import {
  assistantReducer,
  startState,
  type AssistantAction,
  type AssistantState,
} from '../lib/assistant.ts'
import { Answer } from './Answer.tsx'

const question = 'In which version did `satisfies` appear?'

function stateAfter(
  events: readonly AnswerEvent[],
  extra: AssistantAction[] = [],
  agentic = false,
): AssistantState {
  const actions: AssistantAction[] = [
    ...events.map((event) => ({ type: 'event', event }) as const),
    ...extra,
  ]
  return actions.reduce(assistantReducer, startState(question, agentic))
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
      name: 'Source 1: TypeScript 5.0 > @satisfies Support in JSDoc (part 1 of 2). Show it in the inspector',
    })
    await expect(citations).toHaveLength(2)
    await expect(canvas.getByRole('article')).toHaveAttribute('aria-busy', 'false')
    // The question is the user's message, a heading to jump to, and the answer does not repeat it.
    await expect(canvas.getByRole('heading', { level: 2, name: question })).toBeVisible()
    await expect(canvas.getAllByText(question)).toHaveLength(1)
    // Tokens and cost are for the inspector; the main view is plain language.
    await expect(canvasElement).not.toHaveTextContent('claude-sonnet')

    citations[1]?.focus()
    await userEvent.keyboard('{Enter}')
    await expect(args.onCitation).toHaveBeenCalledWith(answerFixture.citations[0], citations[1])
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
    await expect(args.onCitation).toHaveBeenCalledWith(tableAnswerFixture.citations[1], citation)
  },
}

/** A citation right after a code block sits on the text before it, not on a line of its own. */
export const CitationAfterCodeBlock: Story = {
  args: { state: stateAfter(citationAfterCodeFixture.events) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const [marker] = canvas.getAllByRole('button', { name: /^Source 1: / })
    const paragraph = marker?.closest('p')
    await expect(paragraph).toHaveTextContent(/^Pass --strict and then explicitly set/)
    await expect(canvas.getByRole('group', { name: 'Code example' })).toHaveTextContent(
      '--strict --noImplicitThis false',
    )
    // No paragraph holds a marker and nothing else.
    for (const p of canvasElement.querySelectorAll('p')) {
      await expect(p.textContent.trim()).not.toMatch(/^\d+$/)
    }
  },
}

/** Halfway through the stream: one cited block in, the progress dots showing. */
export const Streaming: Story = {
  args: { state: stateAfter(answerFixture.events.slice(0, 9)) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('article')).toHaveAttribute('aria-busy', 'true')
    await expect(canvas.queryByRole('status')).toBeNull()
    await expect(canvas.getAllByRole('button', { name: /^Source / })).toHaveLength(1)
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

/** The first search waits for Voyage's free tier, which allows 3 embedding requests a minute. */
export const WaitingForTheRateLimit: Story = {
  args: { state: stateAfter([{ type: 'wait', ms: 58_300 }]) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('article')).toHaveTextContent(
      "Waiting about 59 seconds for Voyage's rate limit",
    )
    await expect(canvas.queryByRole('list', { name: "Searches of Claude's own" })).toBeNull()
  },
}

const searchedFor = 'checkJs errors in JavaScript files'

/** Agentic mode (ADR-0019): a search of Claude's own, waiting for the rate limit as it runs. */
export const AgenticSearchWaiting: Story = {
  args: {
    state: stateAfter(agenticFixture.events.slice(0, 3), [], true),
    docTypeLabels: { option: 'Compiler options' },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const steps = canvas.getByRole('list', { name: "Searches of Claude's own" })
    const [step, ...more] = within(steps).getAllByRole('listitem')
    await expect(more).toHaveLength(0)
    await expect(step).toHaveTextContent(
      `Searching again for ${searchedFor} in Compiler options: Waiting about 42 seconds for Voyage's rate limit`,
    )
    // The query is quoted, by the browser, so a screen reader reads where it starts and ends.
    await expect(step?.querySelector('q')).toHaveTextContent(searchedFor)
    await expect(canvas.getByRole('article')).toHaveAttribute('aria-busy', 'true')
  },
}

/** The search done: what it brought back stays above the answer, which cites what it found. */
export const AgenticDone: Story = {
  args: {
    state: stateAfter(agenticFixture.events, [], true),
    docTypeLabels: { option: 'Compiler options' },
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const steps = canvas.getByRole('list', { name: "Searches of Claude's own" })
    await expect(steps).toHaveTextContent(
      `Searched again for ${searchedFor} in Compiler options: 8 new results`,
    )
    await expect(canvas.getByRole('article')).toHaveAttribute('aria-busy', 'false')

    const own = agenticFixture.citations.at(-1)
    const [citation] = canvas.getAllByRole('button', { name: /^Source 2: / })
    await userEvent.click(citation ?? canvasElement)
    await expect(args.onCitation).toHaveBeenCalledWith(own, citation)
  },
}

/** Stopped during that wait: the search says it was stopped, and waits no more. */
export const AgenticSearchStopped: Story = {
  args: {
    state: stateAfter(agenticFixture.events.slice(0, 3), [{ type: 'stopped' }], true),
    docTypeLabels: { option: 'Compiler options' },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const steps = canvas.getByRole('list', { name: "Searches of Claude's own" })
    await expect(steps).toHaveTextContent(
      `Searching again for ${searchedFor} in Compiler options: stopped`,
    )
    await expect(canvas.getByRole('article')).not.toHaveTextContent('Waiting')
    await expect(canvas.getByRole('article')).toHaveTextContent('Stopped.')
  },
}

/** The answer failed during that search: the search says it did not finish. */
export const AgenticSearchFailed: Story = {
  args: {
    state: stateAfter(
      agenticFixture.events.slice(0, 2),
      [{ type: 'failed', message: 'Voyage refused the request (500)' }],
      true,
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const steps = canvas.getByRole('list', { name: "Searches of Claude's own" })
    await expect(steps).toHaveTextContent(
      `Searching again for ${searchedFor} in Option: did not finish`,
    )
    await expect(canvas.getByRole('article')).toHaveTextContent(
      'Error: Voyage refused the request (500)',
    )
  },
}
