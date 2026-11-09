import type { MockAnswerRequest, MockGrade } from '@docs-rag-lab/contracts'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { MockInterview } from './MockInterview.tsx'
import {
  FOLLOW_UP_RIGHT,
  MOCK_SESSION,
  PARTLY_RIGHT,
  skippedGrade,
  SOURCE_TITLES,
} from './story-data.ts'

/** Grades as the route would, at once: a skip with no call, else the fixtures' grades. */
const grade = (request: MockAnswerRequest): Promise<MockGrade> =>
  Promise.resolve(
    request.answer === ''
      ? skippedGrade(request)
      : request.step === 'question'
        ? PARTLY_RIGHT
        : FOLLOW_UP_RIGHT,
  )

type Grader = (request: MockAnswerRequest) => Promise<MockGrade>
const neverGraded: Grader = () => new Promise<MockGrade>(() => undefined)
const noKey: Grader = () => Promise.reject(new Error('ANTHROPIC_API_KEY is not set'))

const meta = {
  title: 'Interview/MockInterview',
  component: MockInterview,
  args: {
    session: MOCK_SESSION,
    sourceTitles: SOURCE_TITLES,
    onAnswer: fn(grade),
    onFinish: fn(),
  },
} satisfies Meta<typeof MockInterview>

export default meta
type Story = StoryObj<typeof meta>

/** The first question, before any answer: the prompt takes focus, and the field waits. */
export const FirstQuestion: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('heading', { level: 2 })).toHaveFocus()
    await expect(canvas.getByText('Question 1 of 2')).toBeVisible()
    await expect(canvas.getByRole('textbox', { name: 'Your answer' })).toBeVisible()
    await expect(canvas.queryByText(/The answer from the docs/)).toBeNull()
  },
}

/**
 * The loop by the keyboard: digits and Space type into the field, Ctrl+Enter submits, the
 * feedback takes focus with its score in words, its sources and the docs' answer, and the
 * follow-up is answered the same way. Then the next question takes focus.
 */
export const AnswerAndFollowUp: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('textbox', { name: 'Your answer' }))
    await userEvent.keyboard('Any value; 1 2 3 are truthy')
    await expect(args.onAnswer).not.toHaveBeenCalled()
    await userEvent.keyboard('{Control>}{Enter}{/Control}')

    await waitFor(() => expect(canvas.getByRole('heading', { name: 'Feedback' })).toHaveFocus())
    await expect(args.onAnswer).toHaveBeenCalledWith({
      sessionId: 'session-1',
      questionId: MOCK_SESSION.questions[0]?.id,
      step: 'question',
      answer: 'Any value; 1 2 3 are truthy',
    })
    await expect(canvas.getByText('Score: 1 of 2')).toBeVisible()
    await expect(canvas.getAllByRole('link', { name: /Truthiness narrowing/ })).toHaveLength(3)
    await expect(canvas.getByRole('heading', { name: 'The answer from the docs' })).toBeVisible()
    await expect(canvas.getByRole('heading', { name: 'Follow-up' })).toBeVisible()

    await userEvent.type(
      canvas.getByRole('textbox', { name: 'Your answer to the follow-up' }),
      '0, NaN and the empty string',
    )
    await userEvent.click(canvas.getByRole('button', { name: 'Submit answer' }))
    await waitFor(() =>
      expect(canvas.getByRole('heading', { name: 'Feedback on the follow-up' })).toHaveFocus(),
    )
    await expect(canvas.getByText('Score: 2 of 2')).toBeVisible()

    await userEvent.click(canvas.getByRole('button', { name: 'Next question' }))
    await waitFor(() =>
      expect(canvas.getByRole('heading', { level: 2, name: /risk of an Effect/ })).toHaveFocus(),
    )
    await expect(canvas.getByText('Question 2 of 2')).toBeVisible()
  },
}

/** Skip costs nothing: the step scores 0 with no feedback, and a skipped first answer has no follow-up. */
export const SkipToTheSummary: Story = {
  args: { session: { ...MOCK_SESSION, questions: MOCK_SESSION.questions.slice(1) } },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Skip' }))

    await waitFor(() => expect(canvas.getByRole('heading', { name: 'Feedback' })).toHaveFocus())
    await expect(canvas.getByText(', skipped')).toBeVisible()
    await expect(canvas.queryByRole('heading', { name: 'Follow-up' })).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: 'See the summary' }))
    await expect(args.onFinish).toHaveBeenCalledTimes(1)
  },
}

/** While Claude grades, the buttons wait and the status says so. */
export const Grading: Story = {
  args: { onAnswer: fn(neverGraded) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByRole('textbox', { name: 'Your answer' }), 'Truthiness.')
    await userEvent.click(canvas.getByRole('button', { name: 'Submit answer' }))

    await expect(await canvas.findByText('Grading your answer against the docs.')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Submit answer' })).toBeDisabled()
    await expect(canvas.getByRole('button', { name: 'End the interview' })).toBeDisabled()
  },
}

/** A grade that fails says why, and keeps the answer to try again. */
export const GradeFailed: Story = {
  args: { onAnswer: fn(noKey) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const field = canvas.getByRole('textbox', { name: 'Your answer' })
    await userEvent.type(field, 'Truthiness.')
    await userEvent.click(canvas.getByRole('button', { name: 'Submit answer' }))

    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'The answer was not graded: ANTHROPIC_API_KEY is not set',
    )
    await expect(field).toHaveValue('Truthiness.')
    await expect(canvas.getByRole('button', { name: 'Submit answer' })).toBeEnabled()
  },
}

/** The interview can end at any time, with what was graded so far. */
export const EndEarly: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'End the interview' }))
    await expect(args.onFinish).toHaveBeenCalledTimes(1)
    await expect(args.onAnswer).not.toHaveBeenCalled()
  },
}
