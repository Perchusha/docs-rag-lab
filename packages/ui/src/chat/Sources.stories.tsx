import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { answerFixture } from '../fixtures.ts'
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

    await userEvent.click(canvas.getByRole('button', { name: 'Show chunk 1 in the inspector' }))
    await expect(args.onShow).toHaveBeenCalledWith(answerFixture.citations[0])
  },
}
