import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { PracticeStart } from './PracticeStart.tsx'
import { FIRST_RUN, UNDER_WAY } from './story-data.ts'

const meta = {
  title: 'Interview/PracticeStart',
  component: PracticeStart,
  args: {
    summary: FIRST_RUN,
    sourceTitles: ['TypeScript', 'React'],
    busy: false,
    onQuick: fn(),
  },
} satisfies Meta<typeof PracticeStart>

export default meta
type Story = StoryObj<typeof meta>

/** On the first run nothing is due, so it says what Quick 10 does instead of "0 due". */
export const FirstRun: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText(/Quick 10 picks ten new questions across TypeScript and React/),
    ).toBeVisible()
    await expect(canvas.queryByText(/due now/)).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: 'Quick 10' }))
    await expect(args.onQuick).toHaveBeenCalledOnce()
  },
}

/** Later, how much is due and how it has gone so far. */
export const UnderWay: Story = {
  args: { summary: UNDER_WAY },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText('3 cards due now. 20 of 329 seen, 70% of them good.'),
    ).toBeVisible()
  },
}

/** A technology with no bank yet has nothing to start. */
export const NoQuestionsYet: Story = {
  args: {
    summary: { questions: 0, seen: 0, good: 0, due: 0, reviews: 0 },
    sourceTitles: ['React'],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/no questions for React yet/)).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Quick 10' })).toBeDisabled()
  },
}

export const Loading: Story = {
  args: { summary: undefined },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: 'Quick 10' })).toBeDisabled()
  },
}
