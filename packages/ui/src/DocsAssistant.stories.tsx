import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { DocsAssistant } from './DocsAssistant.tsx'
import { answerFixture, documentFixture, tableAnswerFixture } from './fixtures.ts'
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
 * Reflow at 320 CSS px (WCAG 1.4.10: 1280 px at 400% zoom): the chat and the
 * inspector stack, and nothing scrolls sideways but tables and code blocks.
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

    // Stacked: the inspector starts below the chat.
    const answerBottom = canvas.getByRole('article').getBoundingClientRect().bottom
    const inspector = canvas.getByRole('region', { name: 'Retrieval inspector' })
    await expect(inspector.getBoundingClientRect().top).toBeGreaterThanOrEqual(answerBottom)

    // The table and the long code line do not fit, and scroll in their own boxes.
    const box = canvas.getByRole('group', { name: 'Table: any, unknown' })
    await expect(box.scrollWidth).toBeGreaterThan(box.clientWidth)
    const code = canvas.getAllByRole('group', { name: 'Code example' }).at(-1)
    await expect(code?.scrollWidth).toBeGreaterThan(code?.clientWidth ?? Infinity)
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
