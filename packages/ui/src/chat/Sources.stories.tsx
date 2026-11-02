import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { answerFixture, satisfiesHowFixture, varianceFixture } from '../fixtures.ts'
import { Sources } from './Sources.tsx'

const meta = {
  title: 'Chat/Sources',
  component: Sources,
  args: { citations: answerFixture.citations, onShow: fn() },
} satisfies Meta<typeof Sources>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    // Numbered like the markers in the answer: a list item keeps its marker.
    const [item] = canvas.getAllByRole('listitem')
    await expect(item && getComputedStyle(item).display).toBe('list-item')
    await expect(item).toHaveAttribute('value', '1')

    const link = canvas.getByRole('link', { name: /@satisfies Support in JSDoc/ })
    await expect(link).toHaveAttribute(
      'href',
      'https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-0.html#satisfies-support-in-jsdoc',
    )
    await expect(link).toHaveAttribute('target', '_blank')
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    await expect(link).toHaveAccessibleName(/opens in a new tab/)

    // One numbering: the citation's. No chunk number in the button.
    const show = canvas.getByRole('button', { name: /^Show in the inspector\s*: source 1$/ })
    await expect(canvasElement).not.toHaveTextContent(/chunk \d/i)
    await userEvent.click(show)
    await expect(args.onShow).toHaveBeenCalledWith(answerFixture.citations[0], show)
  },
}

/**
 * Excerpts render as markdown, not as raw text: a recorded ```ts fence is code, with no
 * backticks to read, and a long excerpt starts collapsed behind Show more.
 */
export const RenderedExcerpts: Story = {
  args: { citations: satisfiesHowFixture.citations },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvasElement).not.toHaveTextContent('```')
    await expect(canvasElement).not.toHaveTextContent('`satisfies`')

    const [items] = [canvas.getAllByRole('listitem')]
    const fenced = items[1] ?? canvasElement
    const code = within(fenced).getByRole('group', { name: 'Code example' })
    await expect(code.querySelector('pre code')).toHaveTextContent('type Colors')

    // The collapsed code block stops early, and Show more brings the rest.
    await expect(code).not.toHaveTextContent('The typo is now caught')
    const more = within(fenced).getByRole('button', { name: 'Show more' })
    await expect(more).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(more)
    const less = within(fenced).getByRole('button', { name: 'Show less' })
    await expect(less).toHaveAttribute('aria-expanded', 'true')
    await expect(within(fenced).getByRole('group', { name: 'Code example' })).toHaveTextContent(
      'The typo is now caught',
    )
    await userEvent.click(less)
    await expect(within(fenced).getByRole('button', { name: 'Show more' })).toBeVisible()
  },
}

/** Emphasis in an excerpt is emphasis, not asterisks. */
export const RenderedEmphasis: Story = {
  args: { citations: varianceFixture.citations.slice(0, 1) },
  play: async ({ canvasElement }) => {
    await expect(canvasElement).not.toHaveTextContent('*')
    await expect(canvasElement.querySelector('em')).toHaveTextContent('explicitly')
  },
}
