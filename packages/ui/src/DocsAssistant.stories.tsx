import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { DocsAssistant } from './DocsAssistant.tsx'
import { answerFixture, documentFixture, tableAnswerFixture, traces } from './fixtures.ts'
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
    await expect(canvas.getByRole('heading', { level: 2, name: question })).toBeVisible()
    exampleGate.open()
    await waitFor(() => expect(canvas.getByRole('status')).toHaveTextContent('Answer ready'))
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

const raceGate = replayGate()
const onRaceRequest = fn()

/** A newer search replaces an older one, whichever would finish first. */
export const NewerSearchReplacesOlder: Story = {
  args: {
    transport: replayTransport({
      events: answerFixture.events,
      searchTraces: { hybrid: traces.ts2345, vector: traces.satisfiesVector },
      searchGate: raceGate,
      onRequest: onRaceRequest,
    }),
  },
  play: async ({ canvasElement }) => {
    raceGate.reset()
    onRaceRequest.mockClear()
    const canvas = within(canvasElement)
    await askAndWait(canvasElement, question)
    await userEvent.click(canvas.getByRole('button', HOW))
    const panel = within(panelOf(canvasElement))

    await userEvent.click(panel.getByRole('radio', { name: 'Vector' }))
    await userEvent.click(panel.getByRole('radio', { name: 'Hybrid' }))
    await expect(onRaceRequest.mock.calls.filter(([kind]) => kind === 'search')).toHaveLength(2)

    raceGate.open()
    await waitFor(() =>
      expect(panel.getByRole('status')).toHaveTextContent('Showing a fresh hybrid search'),
    )
    await expect(panel.getByRole('radio', { name: 'Hybrid' })).toBeChecked()
    await expect(panel.getByRole('tab', { name: 'Fusion' })).toHaveAttribute(
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
    const panel = within(panelOf(canvasElement))
    const field = panel.getByRole('textbox', { name: 'Search for' })
    await userEvent.clear(field)
    await userEvent.type(field, 'edited text')

    // The second question has no trace yet, and the panel says so. Focus stays in the input.
    streamGate.reset()
    const input = canvas.getByRole('textbox', { name: 'Question' })
    await userEvent.click(input)
    await userEvent.keyboard('Second question{Enter}')
    await waitFor(() => expect(canvas.getAllByRole('article')).toHaveLength(2))
    await expect(input).toHaveFocus()
    await expect(panel.getByText(/no retrieval trace/)).toBeVisible()
    await expect(field).toHaveValue('Second question')
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
    const panel = within(panelOf(canvasElement))
    await expect(panel.getByRole('textbox', { name: 'Search for' })).toHaveValue('Second question')

    await userEvent.click(first ?? canvasElement)
    await expect(panel.getByRole('textbox', { name: 'Search for' })).toHaveValue('First question')
    await expect(first).toHaveAttribute('aria-expanded', 'true')
    await expect(second).toHaveAttribute('aria-expanded', 'false')
    await waitFor(() =>
      expect(panel.getByRole('heading', { level: 2, name: 'Retrieval inspector' })).toHaveFocus(),
    )
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

/** From 64rem up the panel sits beside the chat, with a scroll of its own. */
export const SidePanelWhenWide: Story = {
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
