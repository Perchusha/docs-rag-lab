import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { QuestionForm } from './QuestionForm.tsx'

const meta = {
  title: 'Chat/QuestionForm',
  component: QuestionForm,
  args: {
    examples: ['In which version did `satisfies` appear?', 'What does error TS2345 mean?'],
    docTypes: ['handbook', 'reference', 'option', 'release-notes', 'other'],
    defaultStrategy: 'hybrid',
    running: false,
    onSubmit: fn(),
    onStop: fn(),
  },
} satisfies Meta<typeof QuestionForm>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const question = canvas.getByRole('textbox', { name: 'Question' })

    await userEvent.click(question)
    await userEvent.keyboard('What does `strict` enable?')
    await userEvent.keyboard('{Control>}{Enter}{/Control}')
    await expect(args.onSubmit).toHaveBeenLastCalledWith('ask', {
      question: 'What does `strict` enable?',
      strategy: 'hybrid',
      docTypes: [],
    })

    await userEvent.click(canvas.getByRole('radio', { name: 'Vector only' }))
    await userEvent.click(canvas.getByRole('checkbox', { name: 'option' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Search only' }))
    await expect(args.onSubmit).toHaveBeenLastCalledWith('search', {
      question: 'What does `strict` enable?',
      strategy: 'vector',
      docTypes: ['option'],
    })

    await userEvent.click(canvas.getByRole('button', { name: 'What does error TS2345 mean?' }))
    await expect(question).toHaveValue('What does error TS2345 mean?')
    await expect(question).toHaveFocus()
    await expect(args.onSubmit).toHaveBeenCalledTimes(2)

    // Stop does nothing while nothing runs, and keeps its place in the tab order.
    const stop = canvas.getByRole('button', { name: 'Stop' })
    await expect(stop).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(stop)
    await expect(args.onStop).not.toHaveBeenCalled()
  },
}

export const EmptyQuestion: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Ask' }))
    await expect(args.onSubmit).not.toHaveBeenCalled()
    await expect(canvas.getByRole('textbox', { name: 'Question' })).toHaveFocus()
  },
}

export const Running: Story = {
  args: { running: true },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Stop' }))
    await expect(args.onStop).toHaveBeenCalledOnce()
  },
}
