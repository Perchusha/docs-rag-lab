import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { DocsAssistant } from './DocsAssistant.tsx'
import { answerFixture, documentFixture } from './fixtures.ts'
import { replayGate, replayTransport } from './lib/replay.ts'

const question = 'In which version did `satisfies` appear?'
const onRequest = fn()

const meta = {
  title: 'DocsAssistant',
  component: DocsAssistant,
  parameters: { layout: 'fullscreen' },
  args: {
    title: 'TypeScript docs assistant',
    tagline: 'Answers from the TypeScript handbook and release notes, with citations',
    examples: [question, 'What does error TS2345 mean?'],
    docTypes: ['handbook', 'reference', 'option', 'release-notes', 'other'],
    defaultStrategy: 'hybrid',
    theme: { accent: { light: '#235a97', dark: '#79b8ff' } },
    endpoints: { ask: '/api/ask', search: '/api/search', documents: '/api/documents' },
    transport: replayTransport({
      events: answerFixture.events,
      documents: [documentFixture],
      delayMs: 15,
      onRequest,
    }),
  },
} satisfies Meta<typeof DocsAssistant>

export default meta
type Story = StoryObj<typeof meta>

export const Idle: Story = {}

const answerGate = replayGate()

/**
 * The recorded answer streams in; a citation shows its chunk in the inspector.
 * The gate holds each state until the test releases it, so no check here races
 * the replay, however slow the machine (ADR-0008).
 */
export const AskAndInspect: Story = {
  args: {
    transport: replayTransport({
      events: answerFixture.events,
      documents: [documentFixture],
      gate: answerGate,
      onRequest,
    }),
  },
  play: async ({ canvasElement }) => {
    answerGate.reset()
    const canvas = within(canvasElement)
    const status = canvas.getByRole('status')
    await userEvent.click(canvas.getByRole('button', { name: question }))
    await userEvent.click(canvas.getByRole('button', { name: 'Ask' }))
    await expect(onRequest).toHaveBeenLastCalledWith('ask', {
      question,
      strategy: 'hybrid',
      docTypes: [],
    })

    // Nothing released: retrieval has not answered, so this state cannot pass.
    await waitFor(() => expect(status).toHaveTextContent('Searching the docs'))
    await expect(canvas.queryByRole('tab', { name: 'Fusion' })).toBeNull()

    // The trace: the inspector fills in before any answer text.
    answerGate.release(1)
    await waitFor(() => expect(status).toHaveTextContent('Writing the answer'))
    const answer = canvas.getByRole('article')
    await expect(answer).toHaveAttribute('aria-busy', 'true')
    await expect(canvas.getByRole('tab', { name: 'Fusion' })).toBeVisible()

    // The first two deltas: the answer shows part of its text, and is still busy.
    answerGate.release(2)
    await waitFor(() => expect(answer).toHaveTextContent('The satisfies operator was introduced'))
    await expect(answer).not.toHaveTextContent('TypeScript 4')
    await expect(answer).toHaveAttribute('aria-busy', 'true')
    await expect(status).toHaveTextContent('Writing the answer')

    answerGate.open()
    await waitFor(() => expect(status).toHaveTextContent('Answer ready, with 1 source'))
    await expect(answer).toHaveAttribute('aria-busy', 'false')
    await expect(canvas.getByRole('tab', { name: 'Fusion' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(canvas.getByText(/for 6 of the top 8 chunks/)).toBeVisible()

    const [citation] = canvas.getAllByRole('button', { name: /^Source 1: / })
    await userEvent.click(citation ?? canvasElement)
    await expect(canvas.getByRole('tab', { name: 'Context (8)' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(
      canvas.getByRole('heading', { name: '1. TypeScript 5.0 > @satisfies Support in JSDoc' }),
    ).toHaveFocus()

    // The citation moved focus once. Leaving the Context tab and coming back
    // keeps focus in the tab list, and the arrow keys keep working.
    canvas.getByRole('tab', { name: 'Context (8)' }).focus()
    await userEvent.keyboard('{ArrowLeft}')
    await expect(canvas.getByRole('tab', { name: 'Lists' })).toHaveFocus()
    await userEvent.keyboard('{ArrowRight}')
    await expect(canvas.getByRole('tab', { name: 'Context (8)' })).toHaveFocus()
    await userEvent.keyboard('{ArrowRight}')
    await expect(canvas.getByRole('tab', { name: 'Document' })).toHaveFocus()
  },
}

export const SearchOnly: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByRole('textbox', { name: 'Question' }), question)
    await userEvent.click(canvas.getByRole('radio', { name: 'Vector only' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Search only' }))
    await expect(onRequest).toHaveBeenLastCalledWith('search', {
      question,
      strategy: 'vector',
      docTypes: [],
    })
    await canvas.findByText('Search done: 8 chunks in the context')
    await expect(canvas.queryByRole('heading', { name: 'Sources' })).toBeNull()
  },
}

const replacedAskGate = replayGate()
const replacingSearchGate = replayGate()
const onReplacedAskEnd = fn()

/**
 * A new question replaces one still running, and nothing of the first reaches
 * the page. The replay keeps sending after its abort, as a real response does
 * with a chunk it has read, so both guards in useAssistant are under test: the
 * abort, and dropping what arrives after it.
 */
export const NewQuestionReplacesRunning: Story = {
  args: {
    transport: replayTransport({
      events: answerFixture.events,
      gate: replacedAskGate,
      searchGate: replacingSearchGate,
      ignoresAbort: true,
      onAskEnd: onReplacedAskEnd,
    }),
  },
  play: async ({ canvasElement }) => {
    replacedAskGate.reset()
    replacingSearchGate.reset()
    onReplacedAskEnd.mockClear()
    const canvas = within(canvasElement)
    const status = canvas.getByRole('status')
    await userEvent.type(canvas.getByRole('textbox', { name: 'Question' }), question)

    // The first question is mid-answer: its trace and some text are on the page.
    await userEvent.click(canvas.getByRole('button', { name: 'Ask' }))
    replacedAskGate.release(3)
    await waitFor(() => expect(canvasElement).toHaveTextContent('operator was introduced'))

    // The new question clears it, and stays searching until the test says so.
    await userEvent.click(canvas.getByRole('button', { name: 'Search only' }))
    await waitFor(() => expect(status).toHaveTextContent('Searching the docs'))
    await expect(canvasElement).not.toHaveTextContent('operator was introduced')

    // Everything the first question still has to send, sent into the new
    // question's searching state, before it has an answer of its own.
    replacedAskGate.open()
    await waitFor(() => expect(onReplacedAskEnd).toHaveBeenCalledWith('aborted'))
    await expect(onReplacedAskEnd).toHaveBeenCalledOnce()
    await expect(status).toHaveTextContent('Searching the docs')
    await expect(canvasElement).not.toHaveTextContent('operator was introduced')

    replacingSearchGate.open()
    await waitFor(() => expect(status).toHaveTextContent('Search done: 8 chunks in the context'))
    await expect(canvas.getByRole('heading', { name: 'Search' })).toBeVisible()
    await expect(canvas.queryByRole('heading', { name: 'Sources' })).toBeNull()
    await expect(canvas.queryAllByRole('button', { name: /^Source / })).toHaveLength(0)
  },
}

const stoppedAskGate = replayGate()
const onStoppedAskEnd = fn()

/** Stop aborts the running question. The gate never opens, so it is always mid-search. */
export const Stop: Story = {
  args: {
    transport: replayTransport({
      events: answerFixture.events,
      gate: stoppedAskGate,
      onAskEnd: onStoppedAskEnd,
    }),
  },
  play: async ({ canvasElement }) => {
    stoppedAskGate.reset()
    onStoppedAskEnd.mockClear()
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByRole('textbox', { name: 'Question' }), question)
    await userEvent.keyboard('{Control>}{Enter}{/Control}')
    const status = canvas.getByRole('status')
    await waitFor(() => expect(status).toHaveTextContent('Searching the docs'))

    await userEvent.click(canvas.getByRole('button', { name: 'Stop' }))
    await waitFor(() => expect(status).toHaveTextContent('Stopped'))
    await waitFor(() =>
      expect(canvas.getByRole('button', { name: 'Stop' })).toHaveAttribute('aria-disabled', 'true'),
    )
    // The abort reached the transport, which is what stops the Claude stream.
    await waitFor(() => expect(onStoppedAskEnd).toHaveBeenCalledWith('aborted'))
    await expect(onStoppedAskEnd).toHaveBeenCalledOnce()
  },
}

export const Failure: Story = {
  args: {
    transport: replayTransport({
      events: answerFixture.events,
      failure: 'there is no index for typescript yet: run drl sync typescript first',
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByRole('textbox', { name: 'Question' }), question)
    await userEvent.click(canvas.getByRole('button', { name: 'Ask' }))
    await expect(
      await canvas.findByText(
        'Error: there is no index for typescript yet: run drl sync typescript first',
      ),
    ).toHaveAttribute('role', 'status')
  },
}
