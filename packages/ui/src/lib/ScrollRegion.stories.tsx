import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { ScrollRegion } from './ScrollRegion.tsx'

/** A box whose content grows on a click, while the box itself stays the same size. */
function Growing() {
  const [wide, setWide] = useState(false)
  return (
    <div style={{ width: '20rem' }}>
      <button
        type="button"
        onClick={() => {
          setWide(true)
        }}
      >
        Widen
      </button>
      <ScrollRegion label="Growing" focusOnlyWhenOverflowing>
        <div style={{ width: wide ? '40rem' : '10rem' }}>Content</div>
      </ScrollRegion>
    </div>
  )
}

const meta = {
  title: 'Lib/ScrollRegion',
  component: Growing,
} satisfies Meta<typeof Growing>

export default meta
type Story = StoryObj<typeof meta>

/** It takes a tab stop only once what it holds no longer fits, even if the box has not changed. */
export const TakesFocusWhenContentGrows: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const region = canvas.getByRole('group', { name: 'Growing' })
    await waitFor(() => expect(region).not.toHaveAttribute('tabindex'))
    await userEvent.click(canvas.getByRole('button', { name: 'Widen' }))
    await waitFor(() => expect(region).toHaveAttribute('tabindex', '0'))
  },
}
