import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { GROUPS, SOURCE_TITLES } from './story-data.ts'
import { TopicMap } from './TopicMap.tsx'

const meta = {
  title: 'Interview/TopicMap',
  component: TopicMap,
  args: { groups: GROUPS, sourceTitles: SOURCE_TITLES, onPractice: fn() },
} satisfies Meta<typeof TopicMap>

export default meta
type Story = StoryObj<typeof meta>

/** Hundreds of pages would be a wall: every section starts collapsed, each saying how many topics. */
export const SectionsStartCollapsed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const toggles = canvas.getAllByRole('button', { expanded: false })
    await expect(toggles).toHaveLength(GROUPS.length)
    await expect(canvas.getByRole('button', { name: /TypeScript: Handbook/ })).toHaveTextContent(
      '5 topics',
    )
    await expect(canvas.queryByRole('button', { name: /^Practice / })).toBeNull()
  },
}

/** A section opens from the keyboard, and focus stays on its button. */
export const OpensFromTheKeyboard: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const handbook = canvas.getByRole('button', { name: /TypeScript: Handbook/ })
    await userEvent.tab()
    await userEvent.tab()
    await expect(handbook).toHaveFocus()

    await userEvent.keyboard('{Enter}')
    await expect(handbook).toHaveAttribute('aria-expanded', 'true')
    await expect(handbook).toHaveFocus()
    await expect(canvas.getByText('12 of 31 seen, 9 good')).toBeVisible()
    await expect(canvas.getByText('34 questions, all new')).toBeVisible()

    await userEvent.tab()
    await expect(canvas.getByRole('button', { name: 'Practice The Basics' })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect(args.onPractice).toHaveBeenCalledWith(GROUPS[0]?.topics[0])
  },
}

/** A search shows every topic it finds with its section, open, and says how many. */
export const SearchShowsWhatItFinds: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const search = canvas.getByRole('searchbox', { name: 'Find a topic' })
    await userEvent.type(search, 'type')

    await expect(canvas.getByRole('status')).toHaveTextContent('3 topics found.')
    await expect(canvas.getByRole('heading', { name: 'TypeScript: Handbook' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Practice Object Types' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Practice Utility Types' })).toBeVisible()
    await expect(canvas.queryByRole('heading', { name: /React/ })).toBeNull()
    await expect(search).toHaveFocus()

    await userEvent.clear(search)
    await userEvent.type(search, 'nothing like it')
    await expect(canvas.getByRole('status')).toHaveTextContent(
      'No topic matches "nothing like it".',
    )

    await userEvent.clear(search)
    await expect(canvas.getAllByRole('button', { expanded: false })).toHaveLength(GROUPS.length)
  },
}
