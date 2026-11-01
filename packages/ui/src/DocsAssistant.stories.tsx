import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { DocsAssistant } from './DocsAssistant.tsx'
import { answerFixture, documentFixture } from './fixtures.ts'
import { replayTransport } from './lib/replay.ts'

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

/** The recorded answer streams in; a citation shows its chunk in the inspector. */
export const AskAndInspect: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const status = canvas.getByRole('status')
    await userEvent.click(canvas.getByRole('button', { name: question }))
    await userEvent.click(canvas.getByRole('button', { name: 'Ask' }))
    await expect(onRequest).toHaveBeenLastCalledWith('ask', {
      question,
      strategy: 'hybrid',
      docTypes: [],
    })
    await expect(status).toHaveTextContent('Searching the docs')

    await expect(await canvas.findByText('Answer ready, with 1 source')).toBe(status)
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

/** A new question replaces one still running: nothing of the first reaches the page. */
export const NewQuestionReplacesRunning: Story = {
  args: {
    // The search answers after the replaced ask would have streamed every event,
    // so an ask that kept going would reach the page.
    transport: replayTransport({ events: answerFixture.events, delayMs: 30, searchDelayMs: 1500 }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const status = canvas.getByRole('status')
    await userEvent.type(canvas.getByRole('textbox', { name: 'Question' }), question)
    await userEvent.click(canvas.getByRole('button', { name: 'Ask' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Search only' }))
    await canvas.findByText('Search done: 8 chunks in the context', undefined, { timeout: 3000 })
    await expect(status).toHaveTextContent('Search done: 8 chunks in the context')
    await expect(canvas.getByRole('heading', { name: 'Search' })).toBeVisible()
    await expect(canvas.queryByRole('heading', { name: 'Sources' })).toBeNull()
    await expect(canvas.queryAllByRole('button', { name: /^Source / })).toHaveLength(0)
  },
}

export const Stop: Story = {
  args: {
    transport: replayTransport({ events: answerFixture.events, delayMs: 400 }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByRole('textbox', { name: 'Question' }), question)
    await userEvent.keyboard('{Control>}{Enter}{/Control}')
    await expect(canvas.getByRole('status')).toHaveTextContent('Searching the docs')
    await userEvent.click(canvas.getByRole('button', { name: 'Stop' }))
    await expect(canvas.getByRole('status')).toHaveTextContent('Stopped')
    await expect(canvas.getByRole('button', { name: 'Stop' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
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
