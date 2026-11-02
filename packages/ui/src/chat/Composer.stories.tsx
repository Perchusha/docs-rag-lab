import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { Composer } from './Composer.tsx'

const meta = {
  title: 'Chat/Composer',
  component: Composer,
  args: {
    placeholder: 'Ask about TypeScript',
    docTypes: ['handbook', 'reference', 'option', 'release-notes', 'other'],
    docTypeLabels: { option: 'Compiler options' },
    filter: [],
    onFilterChange: fn(),
    running: false,
    onSend: fn(),
    onStop: fn(),
  },
} satisfies Meta<typeof Composer>

export default meta
type Story = StoryObj<typeof meta>

/** Enter sends and clears; Shift+Enter adds a line and sends nothing. */
export const EnterSends: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const question = canvas.getByRole('textbox', { name: 'Question' })

    await userEvent.click(question)
    await userEvent.keyboard('First line')
    await userEvent.keyboard('{Shift>}{Enter}{/Shift}')
    await userEvent.keyboard('second line')
    await expect(question).toHaveValue('First line\nsecond line')
    await expect(args.onSend).not.toHaveBeenCalled()

    await userEvent.keyboard('{Enter}')
    await expect(args.onSend).toHaveBeenCalledOnce()
    await expect(args.onSend).toHaveBeenCalledWith('First line\nsecond line')
    await expect(question).toHaveValue('')
    await expect(question).toHaveFocus()
  },
}

/** The button sends too. */
export const SendButton: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByRole('textbox', { name: 'Question' }), 'What is `any`?')
    await userEvent.click(canvas.getByRole('button', { name: 'Send' }))
    await expect(args.onSend).toHaveBeenCalledOnce()
    await expect(args.onSend).toHaveBeenCalledWith('What is `any`?')
    await expect(canvas.getByRole('textbox', { name: 'Question' })).toHaveValue('')
  },
}

/** An empty input sends nothing, whichever way, so a double Enter cannot spend anything. */
export const EmptyQuestion: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const question = canvas.getByRole('textbox', { name: 'Question' })
    await userEvent.click(canvas.getByRole('button', { name: 'Send' }))
    await expect(question).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await userEvent.keyboard('   {Enter}')
    await expect(args.onSend).not.toHaveBeenCalled()
  },
}

/** While an answer streams, Stop takes the place of Send. There is no disabled button. */
export const Running: Story = {
  args: { running: true },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('button', { name: 'Send' })).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: 'Stop' }))
    await expect(args.onStop).toHaveBeenCalledOnce()
    await expect(args.onSend).not.toHaveBeenCalled()
  },
}

/** "Search in": a compact select, not a fieldset of checkboxes. Esc closes it and returns focus. */
export const SearchIn: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const button = canvas.getByRole('button', { name: /^Search in: All docs/ })
    await expect(button).toHaveAttribute('aria-expanded', 'false')
    await expect(canvas.queryByRole('checkbox', { name: 'Handbook' })).toBeNull()

    button.focus()
    await userEvent.keyboard('{Enter}')
    await expect(button).toHaveAttribute('aria-expanded', 'true')

    await userEvent.tab()
    await expect(canvas.getByRole('checkbox', { name: 'Handbook' })).toHaveFocus()
    await userEvent.keyboard(' ')
    await expect(args.onFilterChange).toHaveBeenLastCalledWith(['handbook'])

    await userEvent.keyboard('{Escape}')
    await expect(button).toHaveAttribute('aria-expanded', 'false')
    await expect(button).toHaveFocus()
  },
}

/** A click elsewhere closes it too. */
export const SearchInClosesOnOutsideClick: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const button = canvas.getByRole('button', { name: /^Search in/ })
    await userEvent.click(button)
    await expect(button).toHaveAttribute('aria-expanded', 'true')
    await userEvent.click(canvas.getByRole('textbox', { name: 'Question' }))
    await waitFor(() => expect(button).toHaveAttribute('aria-expanded', 'false'))
  },
}

/** The label says what is chosen, in plain words. */
export const SearchInSummaries: Story = {
  args: { filter: ['option'] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: /^Search in: Compiler options/ })).toBeVisible()
  },
}
