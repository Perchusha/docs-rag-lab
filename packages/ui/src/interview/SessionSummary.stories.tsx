import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { SessionSummary } from './SessionSummary.tsx'
import { MOCK_SUMMARY, SOURCE_TITLES } from './story-data.ts'

const meta = {
  title: 'Interview/SessionSummary',
  component: SessionSummary,
  args: {
    summary: MOCK_SUMMARY,
    sourceTitles: SOURCE_TITLES,
    busy: false,
    onAgain: fn(),
    onHome: fn(),
  },
} satisfies Meta<typeof SessionSummary>

export default meta
type Story = StoryObj<typeof meta>

/** The weak topics, weakest first, each score in words, and the sections to read. */
export const WeakTopics: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('heading', { name: 'Mock interview done' })).toHaveFocus()
    await expect(
      canvas.getByText('3 of 6 over 2 questions. Grading cost about $0.02 at list prices.'),
    ).toBeVisible()
    const weak = canvas.getByRole('heading', { name: 'Weak topics' }).nextElementSibling
    await expect(weak?.textContent).toMatch(/^React > Hooks0 of 2TypeScript > Narrowing3 of 4$/)
    await expect(canvas.getAllByRole('link')).toHaveLength(2)

    await userEvent.click(canvas.getByRole('button', { name: 'Another mock interview' }))
    await expect(args.onAgain).toHaveBeenCalledTimes(1)
  },
}

/** Every answer right: no weak topic, and nothing to read. */
export const EveryAnswerRight: Story = {
  args: {
    summary: {
      ...MOCK_SUMMARY,
      questions: MOCK_SUMMARY.questions.map((result) => ({ ...result, score: result.max })),
      score: 6,
      weakTopics: [],
      read: [],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('None: every answer scored 2 of 2.')).toBeVisible()
    await expect(canvas.getByText('Nothing to read: every answer scored 2 of 2.')).toBeVisible()
  },
}

/** Ended before any answer: nothing was graded, and nothing was spent. */
export const NothingGraded: Story = {
  args: {
    summary: {
      ...MOCK_SUMMARY,
      questions: [],
      score: 0,
      max: 0,
      weakTopics: [],
      read: [],
      costUsd: 0,
    },
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('No answer was graded.')).toBeVisible()
    await expect(canvas.queryByRole('heading', { name: 'Weak topics' })).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: 'Back to topics' }))
    await expect(args.onHome).toHaveBeenCalledTimes(1)
  },
}
