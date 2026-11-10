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

/** A button that shows an icon and no text. Its name comes from its label alone. */
async function expectIconOnly(button: HTMLElement): Promise<void> {
  await expect(button.textContent).toBe('')
  await expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
}

/**
 * The two controls sit in the box's bottom corners with the same gap on every side, and
 * the select's text starts where the input's does.
 */
export const ControlsSitEvenlyInTheBox: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const box = canvas.getByRole('form').getBoundingClientRect()
    const input = canvas.getByRole('textbox', { name: 'Question' })
    const select = canvas.getByRole('button', { name: /^Search in/ })
    const send = canvas.getByRole('button', { name: 'Send' })
    const selectBox = select.getBoundingClientRect()
    const sendBox = send.getBoundingClientRect()

    const gap = box.right - sendBox.right
    await expect(gap).toBeGreaterThan(4)
    for (const other of [
      box.bottom - sendBox.bottom,
      selectBox.left - box.left,
      box.bottom - selectBox.bottom,
    ]) {
      await expect(Math.abs(other - gap)).toBeLessThanOrEqual(1)
    }
    await expect(selectBox.height).toBe(sendBox.height)

    const textStart = (element: HTMLElement) =>
      element.getBoundingClientRect().left + parseFloat(getComputedStyle(element).paddingLeft)
    await expect(Math.abs(textStart(select) - textStart(input))).toBeLessThanOrEqual(1)

    await expectIconOnly(send)
    await expect(select.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  },
}

/** Enter sends and clears; Shift+Enter adds a line and sends nothing. */
export const EnterSends: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const question = canvas.getByRole('textbox', { name: 'Question' })

    await userEvent.tab()
    await expect(question).toHaveFocus()
    // One focus ring, on the box, and none of its own on the input inside it.
    await expect(getComputedStyle(question).outlineStyle).toBe('none')
    await expect(getComputedStyle(canvas.getByRole('form')).outlineStyle).toBe('solid')

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
    await expectIconOnly(canvas.getByRole('button', { name: 'Stop' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Stop' }))
    await expect(args.onStop).toHaveBeenCalledOnce()
    await expect(args.onSend).not.toHaveBeenCalled()

    // By keyboard a click has no count, and Stop still stops.
    canvas.getByRole('button', { name: 'Stop' }).focus()
    await userEvent.keyboard('{Enter}')
    await expect(args.onStop).toHaveBeenCalledTimes(2)
  },
}

/** Presses an Enter that confirms a word: nothing is sent, and the browser keeps the key. */
async function confirmWord(
  root: HTMLElement,
  onSend: (question: string) => void,
  init: KeyboardEventInit,
): Promise<void> {
  const question = within(root).getByRole('textbox', { name: 'Question' })
  await userEvent.type(question, 'Half a word')
  const enter = new KeyboardEvent('keydown', {
    key: 'Enter',
    bubbles: true,
    cancelable: true,
    ...init,
  })
  await expect(question.dispatchEvent(enter)).toBe(true)
  await expect(onSend).not.toHaveBeenCalled()
  await expect(question).toHaveValue('Half a word')

  // The next Enter, with the word confirmed, sends.
  await userEvent.keyboard('{Enter}')
  await expect(onSend).toHaveBeenCalledWith('Half a word')
}

/** Enter that confirms a word in an input method does not send. */
export const EnterDuringComposition: Story = {
  play: async ({ args, canvasElement }) => {
    await confirmWord(canvasElement, args.onSend, { isComposing: true })
  },
}

/** Safari has ended the composition by this keydown, so only keyCode 229 tells. */
export const EnterWithKeyCode229: Story = {
  play: async ({ args, canvasElement }) => {
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- what Safari sends, which the input checks.
    await confirmWord(canvasElement, args.onSend, { isComposing: false, keyCode: 229 })
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

/** Enter on an option toggles it. In a form it would submit, and send a half-written question. */
export const EnterOnAnOptionDoesNotSend: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByRole('textbox', { name: 'Question' }), 'Still writing')
    canvas.getByRole('button', { name: /^Search in/ }).focus()
    await userEvent.keyboard('{Enter}')
    await userEvent.tab()
    await expect(canvas.getByRole('checkbox', { name: 'Handbook' })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect(args.onFilterChange).toHaveBeenLastCalledWith(['handbook'])
    await expect(args.onSend).not.toHaveBeenCalled()
    await expect(canvas.getByRole('textbox', { name: 'Question' })).toHaveValue('Still writing')
  },
}

/** Open, so axe checks this state too: story tests run it on the state a story ends in. */
export const SearchInOpen: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /^Search in/ }))
    const panel = canvas.getByRole('group', { name: 'Search in' })
    await expect(panel).toBeVisible()
    await expect(canvas.getByRole('checkbox', { name: 'Compiler options' })).toBeVisible()

    // It opens right above the button, lined up with it.
    const button = canvas.getByRole('button', { name: /^Search in/ }).getBoundingClientRect()
    const opened = panel.getBoundingClientRect()
    await expect(Math.abs(opened.left - button.left)).toBeLessThanOrEqual(1)
    await expect(opened.bottom).toBeLessThanOrEqual(button.top)
  },
}

/** Focus moving away closes it, either way out, so it does not sit over the input. */
export const SearchInClosesWhenFocusLeaves: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const button = canvas.getByRole('button', { name: /^Search in/ })
    button.focus()
    await userEvent.keyboard('{Enter}')
    await expect(button).toHaveAttribute('aria-expanded', 'true')
    await userEvent.tab({ shift: true })
    await expect(canvas.getByRole('textbox', { name: 'Question' })).toHaveFocus()
    await expect(button).toHaveAttribute('aria-expanded', 'false')

    await userEvent.click(button)
    for (const name of ['Handbook', 'Reference', 'Compiler options', 'Release notes', 'Other']) {
      await userEvent.tab()
      await expect(canvas.getByRole('checkbox', { name })).toHaveFocus()
      await expect(button).toHaveAttribute('aria-expanded', 'true')
    }
    await userEvent.tab()
    await expect(canvas.getByRole('button', { name: 'Send' })).toHaveFocus()
    await expect(button).toHaveAttribute('aria-expanded', 'false')
  },
}

/** A press on a label takes focus off what had it, and must not close the select on the way. */
export const SearchInStaysOpenOnALabel: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const button = canvas.getByRole('button', { name: /^Search in/ })
    await userEvent.click(button)
    await userEvent.click(canvas.getByText('Handbook'))
    await expect(args.onFilterChange).toHaveBeenLastCalledWith(['handbook'])
    await expect(button).toHaveAttribute('aria-expanded', 'true')
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

/**
 * Agentic mode (ADR-0019): a checkbox after the filter, off by default, which says what it costs.
 * It is as tall as the select and on its line, and Enter on it toggles it and sends nothing.
 */
export const SearchAgain: Story = {
  args: { onAgenticChange: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const toggle = canvas.getByRole('checkbox', { name: 'Search again' })
    await expect(toggle).not.toBeChecked()
    await expect(toggle).toHaveAccessibleDescription(
      'When the first results fall short, Claude may search twice more. Slower: on the free tier each extra search can wait up to a minute.',
    )
    const select = canvas.getByRole('button', { name: /^Search in/ }).getBoundingClientRect()
    const label = (toggle.closest('label') ?? toggle).getBoundingClientRect()
    await expect(label.height).toBe(select.height)
    await expect(label.top).toBe(select.top)
    await expect(label.left).toBeGreaterThan(select.right)

    await userEvent.type(canvas.getByRole('textbox', { name: 'Question' }), 'Still writing')
    await userEvent.tab()
    await userEvent.tab()
    await expect(toggle).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect(args.onAgenticChange).toHaveBeenLastCalledWith(true)
    await expect(args.onSend).not.toHaveBeenCalled()
    await expect(canvas.getByRole('textbox', { name: 'Question' })).toHaveValue('Still writing')

    await userEvent.click(canvas.getByText('Search again'))
    await expect(args.onAgenticChange).toHaveBeenCalledTimes(2)
  },
}

/** On: checked, and in the text's color rather than the muted one. */
export const SearchAgainOn: Story = {
  args: { agentic: true, onAgenticChange: fn() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const toggle = canvas.getByRole('checkbox', { name: 'Search again' })
    await expect(toggle).toBeChecked()
    const on = getComputedStyle(toggle.closest('label') ?? toggle).color
    const muted = getComputedStyle(canvas.getByRole('button', { name: /^Search in/ })).color
    await expect(on).not.toBe(muted)
  },
}
