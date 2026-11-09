import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { SOURCES } from './story-data.ts'
import { TechPicker } from './TechPicker.tsx'

const meta = {
  title: 'Interview/TechPicker',
  component: TechPicker,
  args: {
    sources: SOURCES.map((source) => ({ ...source, questions: source.id === 'react' ? 60 : 329 })),
    chosen: ['typescript', 'react'],
    onChange: fn(),
  },
} satisfies Meta<typeof TechPicker>

export default meta
type Story = StoryObj<typeof meta>

export const BothChosen: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('group', { name: 'Technologies' })).toBeVisible()
    await expect(canvas.getByText('329 questions')).toBeVisible()
    await userEvent.click(canvas.getByRole('checkbox', { name: /React/ }))
    await expect(args.onChange).toHaveBeenCalledWith(['typescript'])
  },
}

/** One technology always stays chosen, and the page says why its box cannot be cleared. */
export const OneStaysChosen: Story = {
  args: { chosen: ['react'] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const react = canvas.getByRole('checkbox', { name: /React/ })
    await expect(react).toBeChecked()
    await expect(react).toBeDisabled()
    await expect(react).toHaveAccessibleDescription('One technology stays chosen.')
    await expect(canvas.getByRole('checkbox', { name: /TypeScript/ })).toBeEnabled()
  },
}
