import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState, type ComponentProps } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { DocsAssistant } from './DocsAssistant.tsx'
import {
  agenticFixture,
  answerFixture,
  documentFixture,
  tableAnswerFixture,
  traces,
} from './fixtures.ts'
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

/** Before the first question: the input and the examples, and nothing else. */
export const EmptyState: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('heading', { level: 1, name: 'TypeScript docs assistant' }),
    ).toBeVisible()
    await expect(canvas.getByRole('textbox', { name: 'Question' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Send' })).toBeVisible()
    await expect(canvas.getByRole('list', { name: 'Example questions' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: /^Search in: All docs/ })).toBeVisible()
    await expect(canvas.queryByRole('group', { name: /Doc types/ })).toBeNull()
    await expect(canvas.queryByRole('tablist')).toBeNull()
    await expect(canvas.queryByRole('button', { name: 'Stop' })).toBeNull()
    await expect(canvas.getByRole('status')).toHaveTextContent('')
  },
}

const exampleGate = replayGate()

/** An example sends at once and goes away, and focus moves on to the input. */
export const ExampleSends: Story = {
  args: {
    transport: replayTransport({ events: answerFixture.events, gate: exampleGate, onRequest }),
  },
  play: async ({ canvasElement }) => {
    exampleGate.reset()
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: question }))
    await expect(onRequest).toHaveBeenLastCalledWith('ask', {
      question,
      strategy: 'hybrid',
      docTypes: [],
    })
    await waitFor(() =>
      expect(canvas.queryByRole('list', { name: 'Example questions' })).toBeNull(),
    )
    await expect(canvas.getByRole('textbox', { name: 'Question' })).toHaveFocus()
    // A click brought focus here, so there is no ring.
    await expect(getComputedStyle(canvas.getByRole('form')).outlineStyle).toBe('none')
    await expect(canvas.getByRole('heading', { level: 2, name: question })).toBeVisible()
    exampleGate.open()
    await waitFor(() => expect(canvas.getByRole('status')).toHaveTextContent('Answer ready'))
  },
}

/**
 * Focus shows for the keyboard only. A text field matches :focus-visible on a click too,
 * so without help the input would show a ring, or at least a coloured border, on every click.
 */
export const FocusShowsOnlyFromTheKeyboard: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const input = canvas.getByRole('textbox', { name: 'Question' })
    const box = getComputedStyle(canvas.getByRole('form'))
    const border = box.borderTopColor

    const showsNothing = async () => {
      await expect(box.outlineStyle).toBe('none')
      await expect(box.borderTopColor).toBe(border)
    }

    await userEvent.click(input)
    await expect(input).toHaveFocus()
    await showsNothing()
    await userEvent.keyboard('Typing is not moving focus')
    await showsNothing()
    await userEvent.click(canvas.getByRole('button', { name: /^Search in/ }))
    await showsNothing()
    await userEvent.keyboard('{Escape}')

    await userEvent.tab({ shift: true })
    await expect(input).toHaveFocus()
    await expect(box.outlineStyle).toBe('solid')
    await userEvent.keyboard(', and the ring stays')
    await expect(box.outlineStyle).toBe('solid')

    await userEvent.tab()
    const next = canvas.getByRole('button', { name: /^Search in/ })
    await expect(next).toHaveFocus()
    await expect(getComputedStyle(next).outlineStyle).toBe('solid')
    await expect(box.outlineStyle).toBe('none')

    // A click takes the ring away from what the keyboard gave it to.
    await userEvent.tab({ shift: true })
    await expect(box.outlineStyle).toBe('solid')
    await userEvent.click(input)
    await showsNothing()

    // A click that moves focus to the input is still a click.
    await userEvent.clear(input)
    await userEvent.click(canvas.getByRole('button', { name: 'Send' }))
    await expect(input).toHaveFocus()
    await showsNothing()
  },
}

/** Earlier questions stay in the chat, and the input stops promising a continuation. */
export const EarlierQuestionsStay: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const input = canvas.getByRole('textbox', { name: 'Question' })
    await userEvent.click(input)
    await userEvent.keyboard('First question{Enter}')
    await waitFor(() => expect(canvas.getByRole('status')).toHaveTextContent('Answer ready'))
    await expect(input).toHaveAttribute('placeholder', 'Ask a new question')

    await userEvent.click(input)
    await userEvent.keyboard('Second question{Enter}')
    await waitFor(() => expect(canvas.getAllByRole('article')).toHaveLength(2))
    await waitFor(() => expect(canvas.getByRole('status')).toHaveTextContent('Answer ready'))
    const [first, second] = canvas.getAllByRole('article')
    await expect(first).toHaveAccessibleName('First question')
    await expect(second).toHaveAccessibleName('Second question')
    await expect(first).toHaveAttribute('aria-busy', 'false')
  },
}

const buttonGate = replayGate()

/** Stop takes the place of Send while an answer streams, and it is the same button, so focus stays. */
export const StopReplacesSend: Story = {
  args: { transport: replayTransport({ events: answerFixture.events, gate: buttonGate }) },
  play: async ({ canvasElement }) => {
    buttonGate.reset()
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByRole('textbox', { name: 'Question' }), question)
    const send = canvas.getByRole('button', { name: 'Send' })
    await userEvent.click(send)
    await waitFor(() => expect(send).toHaveAccessibleName('Stop'))
    await expect(send).toHaveFocus()
    await expect(canvas.queryByRole('button', { name: 'Send' })).toBeNull()

    buttonGate.open()
    await waitFor(() => expect(canvas.getByRole('status')).toHaveTextContent('Answer ready'))
    await expect(send).toHaveAccessibleName('Send')
    await expect(send).toHaveFocus()
  },
}

const doubleGate = replayGate()
const onDoubleAskEnd = fn()

/** Send becomes Stop under the pointer, and the second click of a double click must not stop it. */
export const DoubleClickOnSend: Story = {
  args: {
    transport: replayTransport({
      events: answerFixture.events,
      gate: doubleGate,
      onAskEnd: onDoubleAskEnd,
    }),
  },
  play: async ({ canvasElement }) => {
    doubleGate.reset()
    onDoubleAskEnd.mockClear()
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByRole('textbox', { name: 'Question' }), question)
    await userEvent.dblClick(canvas.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Stop' })).toBeVisible())
    await expect(canvas.getByRole('article')).toHaveAttribute('aria-busy', 'true')
    await expect(canvas.getByRole('article')).not.toHaveTextContent('Stopped.')
    await expect(onDoubleAskEnd).not.toHaveBeenCalled()

    doubleGate.open()
    await waitFor(() => expect(canvas.getByRole('status')).toHaveTextContent('Answer ready'))
    await expect(onDoubleAskEnd).toHaveBeenCalledWith('finished')
  },
}

const stoppedTwiceGate = replayGate()
const onStoppedTwiceRequest = fn()

/** Stop becomes Send under the pointer, and the second click must not send what is half written. */
export const DoubleClickOnStop: Story = {
  args: {
    transport: replayTransport({
      events: answerFixture.events,
      gate: stoppedTwiceGate,
      onRequest: onStoppedTwiceRequest,
    }),
  },
  play: async ({ canvasElement }) => {
    stoppedTwiceGate.reset()
    onStoppedTwiceRequest.mockClear()
    const canvas = within(canvasElement)
    const input = canvas.getByRole('textbox', { name: 'Question' })
    await userEvent.click(input)
    await userEvent.keyboard(`${question}{Enter}`)
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Stop' })).toBeVisible())
    await userEvent.type(input, 'A half written follow-up')

    await userEvent.dblClick(canvas.getByRole('button', { name: 'Stop' }))
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Send' })).toBeVisible())
    await expect(canvas.getByRole('article')).toHaveTextContent('Stopped.')
    await expect(onStoppedTwiceRequest).toHaveBeenCalledOnce()
    await expect(input).toHaveValue('A half written follow-up')
  },
}

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
    const input = canvas.getByRole('textbox', { name: 'Question' })
    await userEvent.click(input)
    await userEvent.keyboard(`${question}{Enter}`)
    await expect(input).toHaveValue('')
    await expect(onRequest).toHaveBeenLastCalledWith('ask', {
      question,
      strategy: 'hybrid',
      docTypes: [],
    })

    // Nothing released: retrieval has not answered, so this state cannot pass.
    await waitFor(() => expect(status).toHaveTextContent('Searching the docs'))
    await expect(canvas.queryByRole('tab', { name: 'Fusion' })).toBeNull()
    await expect(canvas.queryByRole('list', { name: 'Example questions' })).toBeNull()

    // The trace: nothing about retrieval shows until someone asks for it.
    answerGate.release(1)
    await waitFor(() => expect(status).toHaveTextContent('Writing the answer'))
    const answer = canvas.getByRole('article')
    await expect(answer).toHaveAttribute('aria-busy', 'true')
    await expect(canvas.queryByRole('tablist')).toBeNull()

    // The first two deltas: the answer shows part of its text, and is still busy.
    answerGate.release(2)
    await waitFor(() => expect(answer).toHaveTextContent('The satisfies operator was introduced'))
    await expect(answer).not.toHaveTextContent('TypeScript 4')
    await expect(answer).toHaveAttribute('aria-busy', 'true')
    await expect(status).toHaveTextContent('Writing the answer')

    answerGate.open()
    await waitFor(() => expect(status).toHaveTextContent('Answer ready, with 1 source'))
    await expect(answer).toHaveAttribute('aria-busy', 'false')
    await expect(canvas.queryByRole('complementary')).toBeNull()

    const [citation] = canvas.getAllByRole('button', { name: /^Source 1: / })
    await userEvent.click(citation ?? canvasElement)
    await expect(canvas.getByRole('tab', { name: 'Context (8)' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(
      canvas.getByRole('heading', {
        name: 'TypeScript 5.0 > @satisfies Support in JSDoc (part 1 of 2)',
      }),
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

const replacedAskGate = replayGate()
const onReplacedAskEnd = fn()

/**
 * A new question stops one still running. The first stays in the chat, stopped,
 * and nothing more reaches it: the replay keeps sending after its abort, as a
 * real response does with a chunk it has read.
 */
export const NewQuestionReplacesRunning: Story = {
  args: {
    transport: replayTransport({
      events: answerFixture.events,
      gate: replacedAskGate,
      ignoresAbort: true,
      onAskEnd: onReplacedAskEnd,
    }),
  },
  play: async ({ canvasElement }) => {
    replacedAskGate.reset()
    onReplacedAskEnd.mockClear()
    const canvas = within(canvasElement)
    const input = canvas.getByRole('textbox', { name: 'Question' })

    // The first question is mid-answer: its trace and some text are on the page.
    await userEvent.click(input)
    await userEvent.keyboard('First question{Enter}')
    replacedAskGate.release(3)
    await waitFor(() => expect(canvasElement).toHaveTextContent('operator was introduced'))

    // Enter sends the new one, while the button still says Stop.
    await userEvent.keyboard('Second question{Enter}')
    await waitFor(() => expect(canvas.getAllByRole('article')).toHaveLength(2))
    const [first, second] = canvas.getAllByRole('article')
    await expect(first).toHaveAttribute('aria-busy', 'false')
    await expect(first).toHaveTextContent('Stopped.')

    // Everything left is released, to both the old question and the new one.
    replacedAskGate.open()
    await waitFor(() => expect(canvas.getByRole('status')).toHaveTextContent('Answer ready'))
    await waitFor(() => expect(onReplacedAskEnd).toHaveBeenCalledTimes(2))
    await expect(onReplacedAskEnd).toHaveBeenCalledWith('aborted')

    // The first answer never grew, and has no sources; the second is whole.
    await expect(first).toHaveTextContent('operator was introduced')
    await expect(first).not.toHaveTextContent('TypeScript 4.9')
    await expect(
      within(first ?? canvasElement).queryByRole('heading', { name: 'Sources' }),
    ).toBeNull()
    await expect(second).toHaveTextContent('TypeScript 4.9')
    await expect(
      within(second ?? canvasElement).getByRole('heading', { name: 'Sources' }),
    ).toBeVisible()
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
    await userEvent.click(canvas.getByRole('textbox', { name: 'Question' }))
    await userEvent.keyboard(`${question}{Enter}`)
    const status = canvas.getByRole('status')
    await waitFor(() => expect(status).toHaveTextContent('Searching the docs'))

    await userEvent.click(canvas.getByRole('button', { name: 'Stop' }))
    await waitFor(() => expect(status).toHaveTextContent('Stopped'))
    await expect(canvas.getByRole('button', { name: 'Send' })).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Stop' })).toBeNull()
    // The abort reached the transport, which is what stops the Claude stream.
    await waitFor(() => expect(onStoppedAskEnd).toHaveBeenCalledWith('aborted'))
    await expect(onStoppedAskEnd).toHaveBeenCalledOnce()
  },
}

/** Asks one question and waits for the whole answer. */
async function askAndWait(root: HTMLElement, text: string): Promise<void> {
  const canvas = within(root)
  await userEvent.click(canvas.getByRole('textbox', { name: 'Question' }))
  await userEvent.keyboard(`${text}{Enter}`)
  const newest = () => canvas.getAllByRole('article').at(-1)
  await waitFor(() => expect(newest()).toHaveAccessibleName(text))
  await waitFor(() => expect(newest()).toHaveAttribute('aria-busy', 'false'))
}

function panelOf(root: HTMLElement): HTMLElement {
  return within(root).getByRole('complementary', { name: 'Retrieval inspector' })
}

const HOW = { name: 'How was this found?' }

/** The panel's search field is a text field too. */
export const SearchFieldShowsFocusOnlyFromTheKeyboard: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await askAndWait(canvasElement, question)
    await userEvent.click(canvas.getByRole('button', HOW))

    const field = canvas.getByRole('textbox', { name: 'Search for' })
    await userEvent.click(field)
    await expect(field).toHaveFocus()
    await expect(getComputedStyle(field).outlineStyle).toBe('none')

    // Tab out of a field that was clicked is the keyboard again.
    await userEvent.tab()
    const button = canvas.getByRole('button', { name: 'Search only' })
    await expect(button).toHaveFocus()
    await expect(getComputedStyle(button).outlineStyle).toBe('solid')
    await userEvent.tab({ shift: true })
    await expect(field).toHaveFocus()
    await expect(getComputedStyle(field).outlineStyle).toBe('solid')

    // A radio is an input, but an arrow on it moves focus, it does not type.
    const radio = canvas.getByRole('radio', { name: 'Vector' })
    await userEvent.click(radio)
    await expect(radio).toHaveFocus()
    await expect(getComputedStyle(radio.closest('label') ?? radio).outlineStyle).toBe('none')
    await userEvent.keyboard('{ArrowLeft}')
    const moved = document.activeElement
    await expect(moved).not.toBe(radio)
    await expect(getComputedStyle(moved?.closest('label') ?? radio).outlineStyle).toBe('solid')
  },
}

/** Closed until asked for. Opening moves focus in; Close, Esc and the button return it. */
export const InspectorOnDemand: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await askAndWait(canvasElement, question)
    await expect(canvas.queryByRole('complementary')).toBeNull()
    await expect(canvas.queryByRole('tablist')).toBeNull()

    const how = canvas.getByRole('button', HOW)
    await expect(how).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(how)
    await expect(how).toHaveAttribute('aria-expanded', 'true')
    const panel = panelOf(canvasElement)
    const heading = within(panel).getByRole('heading', { level: 2, name: 'Retrieval inspector' })
    await waitFor(() => expect(heading).toHaveFocus())
    await expect(within(panel).getByRole('tab', { name: 'Fusion' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(within(panel).getByText(/for 6 of the top 8 chunks/)).toBeVisible()
    await expect(within(panel).getByText(/^The answer used /)).toBeVisible()
    await expect(within(panel).getByRole('textbox', { name: 'Search for' })).toHaveValue(question)

    await userEvent.click(within(panel).getByRole('button', { name: 'Close the inspector' }))
    await expect(canvas.queryByRole('complementary')).toBeNull()
    await expect(how).toHaveFocus()
    await expect(how).toHaveAttribute('aria-expanded', 'false')

    await userEvent.keyboard('{Enter}')
    await waitFor(() =>
      expect(canvas.getByRole('heading', { level: 2, name: 'Retrieval inspector' })).toHaveFocus(),
    )
    await userEvent.keyboard('{Escape}')
    await expect(canvas.queryByRole('complementary')).toBeNull()
    await expect(how).toHaveFocus()

    await userEvent.click(how)
    await userEvent.click(how)
    await expect(canvas.queryByRole('complementary')).toBeNull()
    await expect(how).toHaveFocus()
  },
}

/** A citation opens the panel on its chunk, and focus goes back to that citation. */
export const CitationOpensInspector: Story = {
  args: { transport: replayTransport({ events: answerFixture.events }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await askAndWait(canvasElement, question)
    const chunk = 'TypeScript 5.0 > @satisfies Support in JSDoc (part 1 of 2)'

    const [marker] = canvas.getAllByRole('button', { name: /^Source 1: / })
    await userEvent.click(marker ?? canvasElement)
    await expect(within(panelOf(canvasElement)).getByRole('heading', { name: chunk })).toHaveFocus()
    await expect(
      within(panelOf(canvasElement)).getByRole('tab', { name: 'Context (8)' }),
    ).toHaveAttribute('aria-selected', 'true')
    await userEvent.keyboard('{Escape}')
    await expect(canvas.queryByRole('complementary')).toBeNull()
    await expect(marker).toHaveFocus()

    const show = canvas.getByRole('button', { name: /^Show in the inspector/ })
    await userEvent.click(show)
    await expect(within(panelOf(canvasElement)).getByRole('heading', { name: chunk })).toHaveFocus()
    await userEvent.click(canvas.getByRole('button', { name: 'Close the inspector' }))
    await expect(show).toHaveFocus()
  },
}

const onToggleRequest = fn()
const toggleGate = replayGate()

/**
 * The toggle re-runs retrieval only: one free click. The spy proves there is no
 * second ask(). The next question then uses the method the toggle shows.
 */
export const ToggleMakesNoClaudeCall: Story = {
  args: {
    transport: replayTransport({
      events: answerFixture.events,
      searchTraces: { hybrid: traces.satisfies, vector: traces.satisfiesVector },
      searchGate: toggleGate,
      onRequest: onToggleRequest,
    }),
  },
  play: async ({ canvasElement }) => {
    toggleGate.reset()
    onToggleRequest.mockClear()
    const canvas = within(canvasElement)
    await askAndWait(canvasElement, question)
    await userEvent.click(canvas.getByRole('button', HOW))
    const panel = within(panelOf(canvasElement))
    const status = panel.getByRole('status')

    // Chosen by hand or not, Fusion has nothing to show for a vector search.
    await userEvent.click(panel.getByRole('tab', { name: 'Fusion' }))
    await userEvent.click(panel.getByRole('radio', { name: 'Vector' }))
    await expect(onToggleRequest).toHaveBeenLastCalledWith('search', {
      question,
      strategy: 'vector',
      docTypes: [],
    })
    // Held by the gate: the answer's trace stays until the new one arrives.
    await waitFor(() =>
      expect(status).toHaveTextContent('Searching the docs, with no Claude call.'),
    )
    await expect(panel.getByRole('tab', { name: 'Fusion' })).toHaveAttribute(
      'aria-selected',
      'true',
    )

    toggleGate.open()
    await waitFor(() =>
      expect(status).toHaveTextContent(
        'Showing a fresh vector search, with no Claude call. The answer came from hybrid search.',
      ),
    )
    await expect(panel.getByRole('tab', { name: 'Lists' })).toHaveAttribute('aria-selected', 'true')
    await expect(onToggleRequest.mock.calls.filter(([kind]) => kind === 'ask')).toHaveLength(1)
    await expect(canvas.getAllByRole('article')).toHaveLength(1)

    await askAndWait(canvasElement, 'A next question')
    await expect(onToggleRequest).toHaveBeenLastCalledWith('ask', {
      question: 'A next question',
      strategy: 'vector',
      docTypes: [],
    })
  },
}

const rerankGate = replayGate()
const onRerankRequest = fn()

/** On demand, with no Claude call, and neither the answer nor the next question changes. */
export const CompareWithRerank: Story = {
  args: {
    transport: replayTransport({
      events: answerFixture.events,
      searchTraces: { rerank: traces.satisfiesRerank },
      searchGates: { rerank: rerankGate },
      onRequest: onRerankRequest,
    }),
  },
  play: async ({ canvasElement }) => {
    rerankGate.reset()
    onRerankRequest.mockClear()
    const canvas = within(canvasElement)
    await askAndWait(canvasElement, question)
    await userEvent.click(canvas.getByRole('button', HOW))
    const panel = within(panelOf(canvasElement))
    await userEvent.click(panel.getByRole('tab', { name: 'Reranker' }))
    await userEvent.click(panel.getByRole('button', { name: 'Compare with rerank' }))

    await expect(onRerankRequest).toHaveBeenLastCalledWith('search', {
      question,
      strategy: 'rerank',
      docTypes: [],
    })
    await waitFor(() => expect(panel.getByRole('button', { name: 'Stop waiting' })).toBeVisible())
    await expect(panel.getByText(/this can take a minute/)).toBeVisible()

    rerankGate.open()
    await expect(
      await panel.findByText(/2 chunks would come into the top 8, and 2 would leave/),
    ).toHaveTextContent('The answer above stays as it is.')

    // The panel still shows the answer's own search, and the chat made one call.
    await expect(panel.getByRole('radio', { name: 'Hybrid' })).toBeChecked()
    await userEvent.click(panel.getByRole('tab', { name: 'Fusion' }))
    await expect(panel.getByRole('status')).toHaveTextContent(
      'Changing the method or searching again makes no Claude call.',
    )
    await expect(onRerankRequest.mock.calls.filter(([kind]) => kind === 'ask')).toHaveLength(1)
    await expect(canvas.getAllByRole('article')).toHaveLength(1)

    // The next question stays on hybrid, and the comparison does not follow it there.
    await askAndWait(canvasElement, 'A next question')
    await expect(onRerankRequest).toHaveBeenLastCalledWith('ask', {
      question: 'A next question',
      strategy: 'hybrid',
      docTypes: [],
    })
    const next = within(panelOf(canvasElement))
    await userEvent.click(next.getByRole('tab', { name: 'Reranker' }))
    await expect(next.getByRole('button', { name: 'Compare with rerank' })).toBeVisible()
  },
}

const stopGate = replayGate()

/** Waiting can be given up, and the comparison can then be asked for again. */
export const StopWaitingForRerank: Story = {
  args: {
    transport: replayTransport({
      events: answerFixture.events,
      searchTraces: { rerank: traces.satisfiesRerank },
      searchGates: { rerank: stopGate },
    }),
  },
  play: async ({ canvasElement }) => {
    stopGate.reset()
    const canvas = within(canvasElement)
    await askAndWait(canvasElement, question)
    await userEvent.click(canvas.getByRole('button', HOW))
    const panel = within(panelOf(canvasElement))
    await userEvent.click(panel.getByRole('tab', { name: 'Reranker' }))
    await userEvent.click(panel.getByRole('button', { name: 'Compare with rerank' }))
    await userEvent.click(await panel.findByRole('button', { name: 'Stop waiting' }))

    await expect(panel.getByRole('button', { name: 'Compare with rerank' })).toBeVisible()
    await expect(panel.queryByText(/this can take a minute/)).toBeNull()
    await expect(panel.queryByText(/Error/)).toBeNull()
  },
}

/** A refused call says so where it was asked for, and what the panel shows stays. */
export const RerankFailure: Story = {
  args: {
    transport: replayTransport({
      events: answerFixture.events,
      searchFailure: 'Voyage did not take this rerank call',
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await askAndWait(canvasElement, question)
    await userEvent.click(canvas.getByRole('button', HOW))
    const panel = within(panelOf(canvasElement))
    await userEvent.click(panel.getByRole('tab', { name: 'Reranker' }))
    await userEvent.click(panel.getByRole('button', { name: 'Compare with rerank' }))

    await expect(
      await panel.findByText('Error: Voyage did not take this rerank call.'),
    ).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Compare with rerank' })).toBeVisible()
    await userEvent.click(panel.getByRole('tab', { name: 'Fusion' }))
    await expect(panel.getByRole('table')).toBeVisible()
    await expect(canvas.getByRole('article')).toHaveTextContent('TypeScript 4.9')
  },
}

const onSearchOnlyRequest = fn()

/** Search only takes the edited text and the chosen doc types, and leaves the chat alone. */
export const SearchOnlyWithEditedText: Story = {
  args: {
    transport: replayTransport({
      events: answerFixture.events,
      searchTraces: { hybrid: traces.ts2345 },
      onRequest: onSearchOnlyRequest,
    }),
  },
  play: async ({ canvasElement }) => {
    onSearchOnlyRequest.mockClear()
    const canvas = within(canvasElement)
    await askAndWait(canvasElement, question)
    await userEvent.click(canvas.getByRole('button', HOW))
    const panel = within(panelOf(canvasElement))

    await userEvent.click(canvas.getByRole('button', { name: /^Search in/ }))
    await userEvent.click(canvas.getByRole('checkbox', { name: 'Handbook' }))
    await userEvent.keyboard('{Escape}')

    const field = panel.getByRole('textbox', { name: 'Search for' })
    await userEvent.clear(field)
    await userEvent.type(field, 'What does error TS2345 mean?')
    await userEvent.click(panel.getByRole('button', { name: 'Search only' }))
    await expect(onSearchOnlyRequest).toHaveBeenLastCalledWith('search', {
      question: 'What does error TS2345 mean?',
      strategy: 'hybrid',
      docTypes: ['handbook'],
    })
    await waitFor(() =>
      expect(panel.getByRole('status')).toHaveTextContent('Showing a fresh hybrid search'),
    )
    await expect(onSearchOnlyRequest.mock.calls.filter(([kind]) => kind === 'ask')).toHaveLength(1)
    await expect(canvas.getAllByRole('article')).toHaveLength(1)
    await expect(canvas.getByRole('article')).toHaveAccessibleName(question)
    // The chat's status belongs to the answer, and has not moved.
    await expect(
      canvas.getAllByRole('status').find((status) => !panelOf(canvasElement).contains(status)),
    ).toHaveTextContent('Answer ready')

    // A citation points into the answer's own trace, so it goes back to that one.
    const [marker] = canvas.getAllByRole('button', { name: /^Source 1: / })
    await userEvent.click(marker ?? canvasElement)
    await expect(field).toHaveValue(question)
    await expect(panel.getByRole('status')).toHaveTextContent('Changing the method')
  },
}

/**
 * What a dropped result looks like is nothing happening, so there is no state to
 * wait for: this gives one the time to land, if it were not dropped.
 */
async function landed(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 50))
}

const olderSearch = replayGate()
const newerSearch = replayGate()

/**
 * A newer search replaces an older one, even when the older one finishes last and
 * its response ignores the abort.
 */
export const NewerSearchReplacesOlder: Story = {
  args: {
    transport: replayTransport({
      events: answerFixture.events,
      searchTraces: { hybrid: traces.ts2345, vector: traces.satisfiesVector },
      searchGates: { vector: olderSearch, hybrid: newerSearch },
      ignoresAbort: true,
    }),
  },
  play: async ({ canvasElement }) => {
    olderSearch.reset()
    newerSearch.reset()
    const canvas = within(canvasElement)
    await askAndWait(canvasElement, question)
    await userEvent.click(canvas.getByRole('button', HOW))
    const panel = within(panelOf(canvasElement))

    await userEvent.click(panel.getByRole('radio', { name: 'Vector' }))
    await userEvent.click(panel.getByRole('radio', { name: 'Hybrid' }))

    newerSearch.open()
    const status = panel.getByRole('status')
    await waitFor(() => expect(status).toHaveTextContent('Showing a fresh hybrid search'))
    await expect(panel.getByText('ts2345')).toBeVisible()

    olderSearch.open()
    await landed()
    await expect(status).toHaveTextContent('Showing a fresh hybrid search')
    await expect(panel.getByText('ts2345')).toBeVisible()
    await expect(panel.getByRole('radio', { name: 'Hybrid' })).toBeChecked()
  },
}

const rejectedOlder = replayGate()
const rejectedNewer = replayGate()

/** A real fetch rejects when it is aborted, and that is not an error to show. */
export const AbortedSearchShowsNoError: Story = {
  args: {
    transport: replayTransport({
      events: answerFixture.events,
      searchTraces: { hybrid: traces.ts2345, vector: traces.satisfiesVector },
      searchGates: { vector: rejectedOlder, hybrid: rejectedNewer },
    }),
  },
  play: async ({ canvasElement }) => {
    rejectedOlder.reset()
    rejectedNewer.reset()
    const canvas = within(canvasElement)
    await askAndWait(canvasElement, question)
    await userEvent.click(canvas.getByRole('button', HOW))
    const panel = within(panelOf(canvasElement))
    const status = panel.getByRole('status')

    await userEvent.click(panel.getByRole('radio', { name: 'Vector' }))
    await waitFor(() => expect(status).toHaveTextContent('Searching the docs'))
    await userEvent.click(panel.getByRole('radio', { name: 'Hybrid' }))
    await landed()
    await expect(status).toHaveTextContent('Searching the docs')

    rejectedNewer.open()
    await waitFor(() => expect(status).toHaveTextContent('Showing a fresh hybrid search'))

    // A citation drops a search still running the same way.
    rejectedNewer.reset()
    await userEvent.click(panel.getByRole('radio', { name: 'Vector' }))
    await waitFor(() => expect(status).toHaveTextContent('Searching the docs'))
    const [marker] = canvas.getAllByRole('button', { name: /^Source 1: / })
    await userEvent.click(marker ?? canvasElement)
    await landed()
    await expect(status).not.toHaveTextContent('Error')
  },
}

const leftGate = replayGate()
const leftSearchGate = replayGate()
const onLeftAskEnd = fn()
const onLeftSearchEnd = fn()

/** The assistant with a way to take it off the page, as leaving does. */
function Leaving(props: ComponentProps<typeof DocsAssistant>) {
  const [here, setHere] = useState(true)
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setHere(false)
        }}
      >
        Leave
      </button>
      {here && <DocsAssistant {...props} />}
    </>
  )
}

/** Leaving the page stops the Claude stream, so it spends no more tokens, and any search. */
export const LeavingStopsWhatRuns: Story = {
  render: (args) => <Leaving {...args} />,
  args: {
    transport: replayTransport({
      events: answerFixture.events,
      searchTraces: { vector: traces.satisfiesVector },
      gate: leftGate,
      searchGate: leftSearchGate,
      onAskEnd: onLeftAskEnd,
      onSearchEnd: onLeftSearchEnd,
    }),
  },
  play: async ({ canvasElement }) => {
    leftGate.reset()
    leftSearchGate.reset()
    onLeftAskEnd.mockClear()
    onLeftSearchEnd.mockClear()
    const canvas = within(canvasElement)
    leftGate.open()
    await askAndWait(canvasElement, question)
    await userEvent.click(canvas.getByRole('button', HOW))
    await expect(onLeftAskEnd).toHaveBeenCalledWith('finished')

    // A second answer held mid-stream, and a search held beside it.
    leftGate.reset()
    await userEvent.click(canvas.getByRole('textbox', { name: 'Question' }))
    await userEvent.keyboard('A second question{Enter}')
    await waitFor(() => expect(canvas.getAllByRole('article')).toHaveLength(2))
    await userEvent.click(within(panelOf(canvasElement)).getByRole('radio', { name: 'Vector' }))
    await expect(onLeftSearchEnd).not.toHaveBeenCalled()
    onLeftAskEnd.mockClear()

    await userEvent.click(canvas.getByRole('button', { name: 'Leave' }))
    await waitFor(() => expect(onLeftAskEnd).toHaveBeenCalledWith('aborted'))
    await waitFor(() => expect(onLeftSearchEnd).toHaveBeenCalledWith('aborted'))
  },
}

const citedSearch = replayGate()

/** A citation goes back to the answer's own trace, and a search still running stays out of it. */
export const CitationDropsARunningSearch: Story = {
  args: {
    transport: replayTransport({
      events: answerFixture.events,
      searchTraces: { vector: traces.satisfiesVector },
      searchGate: citedSearch,
      ignoresAbort: true,
    }),
  },
  play: async ({ canvasElement }) => {
    citedSearch.reset()
    const canvas = within(canvasElement)
    await askAndWait(canvasElement, question)
    await userEvent.click(canvas.getByRole('button', HOW))
    const panel = within(panelOf(canvasElement))
    await userEvent.click(panel.getByRole('radio', { name: 'Vector' }))
    const status = panel.getByRole('status')
    await waitFor(() => expect(status).toHaveTextContent('Searching the docs'))

    const [marker] = canvas.getAllByRole('button', { name: /^Source 1: / })
    await userEvent.click(marker ?? canvasElement)
    await waitFor(() => expect(status).toHaveTextContent('The answer came from hybrid search.'))

    citedSearch.open()
    await landed()
    await expect(status).not.toHaveTextContent('Showing a fresh')
    await expect(panel.getByRole('tab', { name: 'Context (8)' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  },
}

const followedSearch = replayGate()

/** A new question starts the panel clean, and a search still running stays out of that too. */
export const NewQuestionDropsARunningSearch: Story = {
  args: {
    transport: replayTransport({
      events: answerFixture.events,
      searchTraces: { vector: traces.satisfiesVector },
      searchGate: followedSearch,
      ignoresAbort: true,
    }),
  },
  play: async ({ canvasElement }) => {
    followedSearch.reset()
    const canvas = within(canvasElement)
    await askAndWait(canvasElement, question)
    await userEvent.click(canvas.getByRole('button', HOW))
    const panel = within(panelOf(canvasElement))
    await userEvent.click(panel.getByRole('radio', { name: 'Vector' }))
    await waitFor(() => expect(panel.getByRole('status')).toHaveTextContent('Searching the docs'))

    await askAndWait(canvasElement, 'A second question')
    const followed = within(panelOf(canvasElement))
    await expect(followed.getByRole('textbox', { name: 'Search for' })).toHaveValue(
      'A second question',
    )
    followedSearch.open()
    await landed()
    await expect(followed.getByRole('status')).not.toHaveTextContent('Showing a fresh')
    await expect(followed.getByRole('tab', { name: 'Fusion' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  },
}

const streamGate = replayGate()
const onStreamEnd = fn()

/** A search never touches the answer streaming beside it, and the panel moves on to it. */
export const SearchBesideStreamingAnswer: Story = {
  args: {
    transport: replayTransport({
      events: answerFixture.events,
      searchTraces: { vector: traces.satisfiesVector },
      gate: streamGate,
      onAskEnd: onStreamEnd,
    }),
  },
  play: async ({ canvasElement }) => {
    streamGate.reset()
    onStreamEnd.mockClear()
    const canvas = within(canvasElement)
    streamGate.open()
    await askAndWait(canvasElement, 'First question')
    const how = canvas.getByRole('button', HOW)
    await userEvent.click(how)
    const field = within(panelOf(canvasElement)).getByRole('textbox', { name: 'Search for' })
    await userEvent.clear(field)
    await userEvent.type(field, 'edited text')

    // The second question has no trace yet, and the panel says so. Focus stays in the input.
    streamGate.reset()
    const input = canvas.getByRole('textbox', { name: 'Question' })
    await userEvent.click(input)
    await userEvent.keyboard('Second question{Enter}')
    await waitFor(() => expect(canvas.getAllByRole('article')).toHaveLength(2))
    await expect(input).toHaveFocus()
    const panel = within(panelOf(canvasElement))
    await expect(panel.getByText(/no retrieval trace/)).toBeVisible()
    await expect(panel.getByRole('textbox', { name: 'Search for' })).toHaveValue('Second question')
    await expect(how).toHaveAttribute('aria-expanded', 'false')

    // Its trace and some text have arrived, and the answer is still busy.
    streamGate.release(3)
    await waitFor(() => expect(panel.getByRole('tablist')).toBeVisible())
    const second = canvas.getAllByRole('article').at(-1)
    await waitFor(() => expect(second).toHaveTextContent('operator was introduced'))

    await userEvent.click(panel.getByRole('radio', { name: 'Vector' }))
    await waitFor(() =>
      expect(panel.getByRole('status')).toHaveTextContent('Showing a fresh vector search'),
    )
    await expect(second).toHaveAttribute('aria-busy', 'true')
    await expect(canvas.getByRole('button', { name: 'Stop' })).toBeVisible()
    await expect(onStreamEnd).toHaveBeenCalledOnce()

    streamGate.open()
    await waitFor(() => expect(second).toHaveAttribute('aria-busy', 'false'))
    await expect(second).toHaveTextContent('TypeScript 4.9')
    await waitFor(() => expect(onStreamEnd).toHaveBeenCalledTimes(2))
    await expect(onStreamEnd).toHaveBeenLastCalledWith('finished')

    // What opened the panel belongs to the first answer, so closing goes to the input.
    await userEvent.click(panel.getByRole('button', { name: 'Close the inspector' }))
    await expect(input).toHaveFocus()
  },
}

/** Each answer has its own button, which shows that answer's trace. */
export const EachAnswerHasItsOwn: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await askAndWait(canvasElement, 'First question')
    await askAndWait(canvasElement, 'Second question')
    const [first, second] = canvas.getAllByRole('button', HOW)
    await userEvent.click(second ?? canvasElement)
    const onSecond = within(panelOf(canvasElement))
    await expect(onSecond.getByRole('textbox', { name: 'Search for' })).toHaveValue(
      'Second question',
    )

    // The sort and the rows stay with their answer's panel.
    await userEvent.click(onSecond.getByRole('button', { name: /^Vector/ }))
    await expect(onSecond.getByRole('columnheader', { name: /^Vector/ })).toHaveAttribute(
      'aria-sort',
    )
    await userEvent.click(onSecond.getByRole('button', { name: /^Show all/ }))

    await userEvent.click(first ?? canvasElement)
    await expect(first).toHaveAttribute('aria-expanded', 'true')
    await expect(second).toHaveAttribute('aria-expanded', 'false')
    const onFirst = within(panelOf(canvasElement))
    await expect(onFirst.getByRole('textbox', { name: 'Search for' })).toHaveValue('First question')
    await waitFor(() =>
      expect(onFirst.getByRole('heading', { level: 2, name: 'Retrieval inspector' })).toHaveFocus(),
    )
    await expect(onFirst.getByRole('columnheader', { name: /^Fused/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    )
    await expect(onFirst.getByRole('button', { name: /^Show all/ })).toBeVisible()

    // So do the tab and the selection.
    await userEvent.click(onFirst.getByRole('tab', { name: /^Context/ }))
    const [select] = onFirst.getAllByRole('button', { name: 'Select for the Document tab' })
    await userEvent.click(select ?? canvasElement)
    await expect(onFirst.getByText('selected')).toBeVisible()

    await userEvent.click(second ?? canvasElement)
    const backOnSecond = within(panelOf(canvasElement))
    await expect(backOnSecond.getByRole('tab', { name: 'Fusion' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(backOnSecond.queryByText('selected')).toBeNull()
  },
}

/** A search that fails says so, and the trace below stays. */
export const SearchFailure: Story = {
  args: {
    transport: replayTransport({ events: answerFixture.events, searchFailure: 'overloaded' }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await askAndWait(canvasElement, question)
    await userEvent.click(canvas.getByRole('button', HOW))
    const panel = within(panelOf(canvasElement))
    await userEvent.click(panel.getByRole('radio', { name: 'Vector' }))
    await waitFor(() => expect(panel.getByRole('status')).toHaveTextContent('Error: overloaded'))
    await expect(panel.getByRole('tablist')).toBeVisible()
    await expect(canvas.getByRole('article')).toHaveTextContent('TypeScript 4.9')
  },
}

const WIDE = {
  parameters: {
    viewport: {
      options: {
        wide: {
          name: '1280 CSS px',
          type: 'desktop',
          styles: { width: '1280px', height: '800px' },
        },
      },
    },
  },
  globals: { viewport: { value: 'wide' } },
}

/**
 * A second question goes to the top of the page, with room for its answer above
 * the input, however short the answers are.
 */
export const NewQuestionComesIntoView: Story = {
  ...WIDE,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(window.innerHeight).toBe(800)
    await askAndWait(canvasElement, 'First question')
    await askAndWait(canvasElement, 'Second question')
    const heading = canvas.getByRole('heading', { level: 2, name: 'Second question' })
    await waitFor(() => expect(heading.getBoundingClientRect().top).toBeLessThan(80))
    await expect(heading.getBoundingClientRect().top).toBeGreaterThanOrEqual(0)
  },
}

const stackedGate = replayGate()

/** With the panel stacked, the page has no room until the trace fills it, so it scrolls again then. */
export const NewQuestionAboveStackedPanel: Story = {
  parameters: {
    viewport: {
      options: {
        stacked: {
          name: '800 CSS px',
          type: 'tablet',
          styles: { width: '800px', height: '600px' },
        },
      },
    },
  },
  globals: { viewport: { value: 'stacked' } },
  args: { transport: replayTransport({ events: answerFixture.events, gate: stackedGate }) },
  play: async ({ canvasElement }) => {
    stackedGate.reset()
    stackedGate.open()
    const canvas = within(canvasElement)
    await expect(window.innerWidth).toBe(800)
    await askAndWait(canvasElement, 'First question')
    await userEvent.click(canvas.getByRole('button', HOW))

    stackedGate.reset()
    await userEvent.click(canvas.getByRole('textbox', { name: 'Question' }))
    await userEvent.keyboard('Second question{Enter}')
    await waitFor(() => expect(canvas.getAllByRole('article')).toHaveLength(2))
    stackedGate.release(1)
    await waitFor(() =>
      expect(panelOf(canvasElement).querySelector('[role="tablist"]')).not.toBeNull(),
    )
    const heading = canvas.getByRole('heading', { level: 2, name: 'Second question' })
    await waitFor(() => expect(heading.getBoundingClientRect().top).toBeLessThan(80))
    stackedGate.open()
  },
}

/**
 * The input is always in view, so focus in it leaves the page where it is. With the page's
 * room for the input in force, the caret counted as hidden behind it, and each real key
 * scrolled the page down. Keys from userEvent and insertText never bring the caret into
 * view, so this checks the rule through focus(), which scrolls by the same rule.
 */
export const FocusInTheInputKeepsThePageStill: Story = {
  ...WIDE,
  args: { transport: replayTransport({ events: tableAnswerFixture.events }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await askAndWait(canvasElement, question)
    const page = document.documentElement
    await expect(page.scrollHeight).toBeGreaterThan(window.innerHeight)

    const input = canvas.getByRole('textbox', { name: 'Question' })
    input.blur()
    window.scrollTo(0, 0)
    input.focus()
    await expect(window.scrollY).toBe(0)
    await expect(getComputedStyle(page).scrollPaddingBottom).toBe('auto')
  },
}

/**
 * WCAG 2.4.11: the input sticks to the bottom and grows with its text, and it never
 * covers what has focus. Tabs through a long answer with ten lines in the input.
 */
export const InputNeverCoversFocus: Story = {
  ...WIDE,
  args: { transport: replayTransport({ events: tableAnswerFixture.events }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await askAndWait(canvasElement, question)

    const input = canvas.getByRole('textbox', { name: 'Question' })
    await userEvent.click(input)
    await userEvent.keyboard('A line{Shift>}{Enter}{/Shift}'.repeat(10))
    const form = canvas.getByRole('form', { name: 'Ask the docs' })
    // Taller than the padding the page has before it has measured anything.
    await expect(form.getBoundingClientRect().height).toBeGreaterThan(200)
    const page = document.documentElement
    const measured = () => parseFloat(page.style.getPropertyValue('--dock-height'))
    await waitFor(() => expect(measured()).toBeGreaterThan(form.getBoundingClientRect().height))

    const covered: string[] = []
    const first = canvas
      .getByRole('article')
      .querySelector<HTMLElement>('a, button, [tabindex="0"]')
    first?.focus()
    await expect(document.activeElement).toBe(first)
    // Kept clear only with focus out of the input: see FocusInTheInputKeepsThePageStill.
    await expect(parseFloat(getComputedStyle(page).scrollPaddingBottom)).toBeGreaterThan(
      form.getBoundingClientRect().height,
    )
    let stops = 0
    for (let stop = 0; stop < 60 && document.activeElement !== input; stop += 1) {
      stops += 1
      const element = document.activeElement
      if (element !== null) {
        const { top, bottom } = element.getBoundingClientRect()
        const free = form.getBoundingClientRect().top
        // What fits above the input is whole. A taller box, like a table with wider fonts
        // than here, cannot be, and 2.4.11 asks only that it is not entirely hidden.
        const inView =
          bottom - top <= free ? top >= -1 && bottom <= free + 1 : top < free && bottom > 0
        if (!inView)
          covered.push(`${describeElement(element)}: ${top.toFixed(0)} to ${bottom.toFixed(0)}`)
      }
      await userEvent.tab()
    }
    await expect(document.activeElement).toBe(input)
    // Citations, the table's and the code's boxes, and the sources below them.
    await expect(stops).toBeGreaterThan(20)
    await expect(covered).toEqual([])
  },
}

/** From 64rem up the panel sits beside the chat, with a scroll of its own. */
export const SidePanelWhenWide: Story = {
  ...WIDE,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(window.innerWidth).toBe(1280)
    await askAndWait(canvasElement, question)

    // Closed: the chat is a centered column.
    const main = canvas.getByRole('main')
    const closed = main.getBoundingClientRect()
    await expect(closed.width).toBeLessThanOrEqual(760)
    await expect(Math.abs(closed.left - (1280 - closed.right))).toBeLessThanOrEqual(1)

    await userEvent.click(canvas.getByRole('button', HOW))
    const panel = panelOf(canvasElement).getBoundingClientRect()
    await expect(panel.left).toBeGreaterThanOrEqual(main.getBoundingClientRect().right)
    await expect(panel.top).toBeLessThan(window.innerHeight)
    const box = panelOf(canvasElement).parentElement ?? canvasElement
    await expect(getComputedStyle(box).overflowY).toBe('auto')
    await expect(box.getBoundingClientRect().height).toBeLessThanOrEqual(window.innerHeight)
    await expect(reflowProblems(canvasElement)).toEqual([])
  },
}

/** The only boxes allowed to scroll sideways: a table's or a code block's. */
const WIDE_BOX = '[role="group"][tabindex="0"]'

function describeElement(element: Element): string {
  const name = element.getAttribute('aria-label') ?? element.getAttribute('role') ?? ''
  const text = element.textContent.slice(0, 40)
  return `<${element.tagName.toLowerCase()}> ${name} "${text}"`
}

/** Everything that would make the page scroll sideways at the current width. */
function reflowProblems(root: HTMLElement): string[] {
  const page = document.documentElement
  const problems: string[] = []
  if (page.scrollWidth > page.clientWidth) {
    problems.push(`the page scrolls: ${String(page.scrollWidth)} in ${String(page.clientWidth)}`)
  }
  for (const element of root.querySelectorAll('*')) {
    const box = element.closest(WIDE_BOX)
    // What is inside a table's or a code block's box may be as wide as it likes.
    if (box !== null && box !== element) continue
    const right = element.getBoundingClientRect().right
    if (right > page.clientWidth + 0.5) {
      problems.push(`${describeElement(element)} ends at ${right.toFixed(0)}`)
    }
    if (box === element) continue
    const { overflowX } = getComputedStyle(element)
    const scrolls = overflowX === 'auto' || overflowX === 'scroll'
    if (scrolls && element.scrollWidth > element.clientWidth) {
      problems.push(`${describeElement(element)} scrolls sideways`)
    }
  }
  return problems
}

/**
 * Reflow at 320 CSS px (WCAG 1.4.10: 1280 px at 400% zoom): in the empty state,
 * with the panel closed and with it open, stacked below the chat, nothing scrolls
 * sideways but tables and code blocks.
 * Uses the table answer, whose table and code really are wider than the page,
 * so axe's scrollable-region rule has something to check here.
 */
export const Reflow320: Story = {
  parameters: {
    viewport: {
      options: {
        reflow: { name: '320 CSS px', type: 'mobile', styles: { width: '320px', height: '256px' } },
      },
    },
  },
  globals: { viewport: { value: 'reflow' } },
  args: {
    transport: replayTransport({
      // With one more code block, with a line too long for the page.
      events: [
        ...tableAnswerFixture.events.slice(0, -1),
        {
          type: 'text',
          text: '\n\n```ts\nconst aNameThatGoesOnAndOn: Record<string, unknown> = { key: 1, other: 2 }\n```\n',
        },
        ...tableAnswerFixture.events.slice(-1),
      ],
      // The layout is what counts here, so any document can stand in for this trace's.
      documents: tableAnswerFixture.events.flatMap((event) =>
        event.type === 'trace'
          ? event.trace.context.flatMap((chunk) => {
              const path = event.trace.chunks[chunk.chunkId]?.docPath
              return path === undefined ? [] : [{ ...documentFixture, path }]
            })
          : [],
      ),
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(window.innerWidth).toBe(320)
    await expect(reflowProblems(canvasElement)).toEqual([])

    await userEvent.type(canvas.getByRole('textbox', { name: 'Question' }), question)
    await userEvent.click(canvas.getByRole('button', { name: 'Send' }))
    await waitFor(() =>
      expect(canvas.getByRole('status')).toHaveTextContent('Answer ready, with 4 sources'),
    )
    // The panel starts closed, and the chat alone fits too.
    await expect(canvas.queryByRole('complementary')).toBeNull()

    // The table and the long code line do not fit, and scroll in their own boxes.
    const box = canvas.getByRole('group', { name: 'Table: any, unknown' })
    await expect(box.scrollWidth).toBeGreaterThan(box.clientWidth)
    const code = canvas.getAllByRole('group', { name: 'Code example' }).at(-1)
    await expect(code?.scrollWidth).toBeGreaterThan(code?.clientWidth ?? Infinity)
    await expect(reflowProblems(canvasElement)).toEqual([])

    // Stacked: the inspector starts below the chat.
    await userEvent.click(canvas.getByRole('button', HOW))
    const answerBottom = canvas.getByRole('article').getBoundingClientRect().bottom
    await expect(panelOf(canvasElement).getBoundingClientRect().top).toBeGreaterThanOrEqual(
      answerBottom,
    )
    await expect(reflowProblems(canvasElement)).toEqual([])

    for (const name of ['Lists', /^Context/, 'Document', 'Fusion']) {
      await userEvent.click(canvas.getByRole('tab', { name }))
      await expect(canvas.getByRole('tabpanel')).toBeVisible()
      await expect(reflowProblems(canvasElement)).toEqual([])
    }
    await canvas.findByRole('group', { name: 'Fused ranking' })
    await userEvent.click(canvas.getByRole('tab', { name: 'Document' }))
    await canvas.findByRole('list', { name: 'Chunks of TypeScript 4.9' })
    await expect(reflowProblems(canvasElement)).toEqual([])
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
    await userEvent.click(canvas.getByRole('button', { name: 'Send' }))
    await expect(
      await canvas.findByText(
        'Error: there is no index for typescript yet: run drl sync typescript first',
      ),
    ).toHaveAttribute('role', 'status')
  },
}

/**
 * The link to the eval results comes last: the input, the filter, Send and the four examples are
 * the 7 stops before a first question (journal, M3 follow-up), and it adds none to them. Search
 * again (ADR-0019) is the eighth, after the filter.
 */
export const EvalLink: Story = {
  args: {
    evalHref: '/eval',
    examples: [question, 'What does error TS2345 mean?', 'Third example', 'Fourth example'],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const link = canvas.getByRole('link', { name: 'Eval results' })
    await expect(link).toHaveAttribute('href', '/eval')
    await userEvent.tab()
    await expect(canvas.getByRole('textbox', { name: 'Question' })).toHaveFocus()
    for (let stop = 2; stop <= 8; stop++) {
      await userEvent.tab()
      await expect(link).not.toHaveFocus()
      await expect(canvasElement.contains(document.activeElement)).toBe(true)
    }
    await userEvent.tab()
    await expect(link).toHaveFocus()
    // It stays under the input after the first question, when the examples have gone.
    await expect(canvas.getByRole('textbox', { name: 'Question' })).toBeVisible()
  },
}

const searchedFor = 'checkJs errors in JavaScript files'
const agenticGate = replayGate()
const onAgenticRequest = fn()

/**
 * Agentic mode (ADR-0019), step by step: Search again sends `agentic`, and each search of Claude's
 * own shows as it starts, while it waits for the rate limit, and with what it found when it ends.
 * Stop stays all along. A citation of what that search found opens the inspector on it.
 */
export const AgenticStepsLive: Story = {
  args: {
    docTypeLabels: { option: 'Compiler options' },
    transport: replayTransport({
      events: agenticFixture.events,
      documents: [documentFixture],
      gate: agenticGate,
      onRequest: onAgenticRequest,
    }),
  },
  play: async ({ canvasElement }) => {
    agenticGate.reset()
    onAgenticRequest.mockClear()
    const canvas = within(canvasElement)
    const status = canvas.getByRole('status')
    await userEvent.click(canvas.getByRole('checkbox', { name: 'Search again' }))
    await expect(canvas.getByRole('checkbox', { name: 'Search again' })).toBeChecked()
    await userEvent.click(canvas.getByRole('textbox', { name: 'Question' }))
    await userEvent.keyboard(`${question}{Enter}`)
    await expect(onAgenticRequest).toHaveBeenLastCalledWith('ask', {
      question,
      strategy: 'hybrid',
      docTypes: [],
      agentic: true,
    })
    await waitFor(() => expect(status).toHaveTextContent('Searching the docs'))

    // The question's search: Claude reads it, and nothing streams until it has read enough.
    agenticGate.release(1)
    await waitFor(() => expect(status).toHaveTextContent('Reading the results'))
    const answer = canvas.getByRole('article')
    await expect(answer).toHaveAttribute('aria-busy', 'true')

    // A search of its own starts.
    agenticGate.release(1)
    await waitFor(() => expect(status).toHaveTextContent(`Searching again for "${searchedFor}"`))
    const steps = canvas.getByRole('list', { name: "Searches of Claude's own" })
    await expect(steps).toHaveTextContent(`Searching again for ${searchedFor} in Compiler options`)
    await expect(canvas.getByRole('button', { name: 'Stop' })).toBeVisible()

    // It waits for Voyage's rate limit, and says so in the answer and in the status.
    agenticGate.release(1)
    const waiting = "Waiting about 42 seconds for Voyage's rate limit"
    await waitFor(() =>
      expect(status).toHaveTextContent(`Searching again for "${searchedFor}". ${waiting}`),
    )
    await expect(steps).toHaveTextContent(waiting)
    await expect(canvas.getByRole('button', { name: 'Stop' })).toBeVisible()

    // Its results.
    agenticGate.release(1)
    await waitFor(() =>
      expect(steps).toHaveTextContent(
        `Searched again for ${searchedFor} in Compiler options: 3 new results, 5 already shown`,
      ),
    )
    await expect(status).toHaveTextContent('Reading the results')

    agenticGate.open()
    await waitFor(() => expect(status).toHaveTextContent('Answer ready, with 2 sources'))
    await expect(steps).toBeVisible()

    // The citation of what Claude's own search found opens the panel on that search.
    const [citation] = canvas.getAllByRole('button', { name: /^Source 2: / })
    await userEvent.click(citation ?? canvasElement)
    const panel = panelOf(canvasElement)
    const searches = within(panel).getByRole('group', { name: "The answer's searches" })
    await expect(within(searches).getByRole('radio', { name: `2. "${searchedFor}"` })).toBeChecked()
    await expect(within(panel).getByRole('tab', { name: 'Context (8)' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(
      within(panel).getByRole('heading', { name: 'TSConfig Option: checkJs' }),
    ).toHaveFocus()
    const field = within(panel).getByRole('textbox', { name: 'Search for' })
    await expect(field).toHaveValue(searchedFor)

    // The question's own search is one choice away, and the question comes back with it.
    await userEvent.click(within(searches).getByText('1. The question'))
    await expect(within(searches).getByRole('radio', { name: '1. The question' })).toBeChecked()
    await expect(field).toHaveValue(question)
    await expect(
      within(panel).queryByRole('heading', { name: 'TSConfig Option: checkJs' }),
    ).toBeNull()
  },
}

const agenticStopGate = replayGate()
const onAgenticStopEnd = fn()

/** Stop while a search of Claude's own waits for the rate limit: the abort reaches the transport. */
export const AgenticStopWhileWaiting: Story = {
  args: {
    transport: replayTransport({
      events: agenticFixture.events,
      gate: agenticStopGate,
      onAskEnd: onAgenticStopEnd,
    }),
  },
  play: async ({ canvasElement }) => {
    agenticStopGate.reset()
    onAgenticStopEnd.mockClear()
    const canvas = within(canvasElement)
    const status = canvas.getByRole('status')
    await userEvent.click(canvas.getByRole('checkbox', { name: 'Search again' }))
    await userEvent.click(canvas.getByRole('textbox', { name: 'Question' }))
    await userEvent.keyboard(`${question}{Enter}`)
    agenticStopGate.release(3)
    await waitFor(() => expect(status).toHaveTextContent(/Waiting about 42 seconds/))

    await userEvent.click(canvas.getByRole('button', { name: 'Stop' }))
    await waitFor(() => expect(status).toHaveTextContent('Stopped'))
    await waitFor(() => expect(onAgenticStopEnd).toHaveBeenCalledWith('aborted'))
    await expect(onAgenticStopEnd).toHaveBeenCalledOnce()
    const steps = canvas.getByRole('list', { name: "Searches of Claude's own" })
    await expect(steps).toHaveTextContent(`Searching again for ${searchedFor} in Option: stopped`)
    await expect(canvas.getByRole('article')).not.toHaveTextContent('Waiting')
    await expect(canvas.getByRole('button', { name: 'Send' })).toBeVisible()
  },
}

/**
 * Reflow at 320 CSS px with agentic mode: the toggle wraps under the filter, a long query wraps in
 * its step, and the panel's choice of searches wraps too, so nothing scrolls sideways.
 */
export const AgenticReflow320: Story = {
  parameters: Reflow320.parameters,
  globals: Reflow320.globals,
  args: {
    docTypeLabels: { option: 'Compiler options' },
    transport: replayTransport({
      events: agenticFixture.events.map((event) =>
        event.type === 'search'
          ? { ...event, query: `${searchedFor} with checkJs, allowJs and JSDoc annotations` }
          : event,
      ),
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(window.innerWidth).toBe(320)
    await expect(reflowProblems(canvasElement)).toEqual([])

    await userEvent.click(canvas.getByRole('checkbox', { name: 'Search again' }))
    await userEvent.type(canvas.getByRole('textbox', { name: 'Question' }), question)
    await userEvent.click(canvas.getByRole('button', { name: 'Send' }))
    await waitFor(() =>
      expect(canvas.getByRole('status')).toHaveTextContent('Answer ready, with 2 sources'),
    )
    await expect(reflowProblems(canvasElement)).toEqual([])

    const [citation] = canvas.getAllByRole('button', { name: /^Source 2: / })
    await userEvent.click(citation ?? canvasElement)
    await expect(
      within(panelOf(canvasElement)).getByRole('group', { name: "The answer's searches" }),
    ).toBeVisible()
    await expect(reflowProblems(canvasElement)).toEqual([])
  },
}
