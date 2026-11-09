import type {
  AnswerCheckRequest,
  FlagRequest,
  MockAnswerRequest,
  ReviewRequest,
} from '@docs-rag-lab/contracts'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { InterviewPrep } from './InterviewPrep.tsx'
import { CARDS, reflowProblems, SOURCES, storyTransport, UNDER_WAY } from './story-data.ts'

const meta = {
  title: 'Interview/InterviewPrep',
  component: InterviewPrep,
  args: {
    title: 'Interview prep',
    tagline: 'Questions from the TypeScript and React docs, with compiler-verified answers',
    sources: SOURCES,
    theme: { accent: { light: '#6f42c1', dark: '#b392f0' } },
    endpoints: {
      overview: '/o',
      deck: '/d',
      review: '/r',
      flag: '/f',
      mock: '/m',
      mockAnswer: '/ma',
      mockSummary: '/ms',
      check: '/c',
    },
    transport: storyTransport(),
  },
} satisfies Meta<typeof InterviewPrep>

export default meta
type Story = StoryObj<typeof meta>

/** The first run: both technologies, what Quick 10 does, and the topic map collapsed. */
export const FirstRun: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText(/Nothing to review yet/)).toBeVisible()
    await expect(canvas.getByRole('heading', { name: 'Topics' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Quick 10' })).toBeEnabled()
  },
}

const reviews: ReviewRequest[] = []

/**
 * Quick 10 from end to end, by the keyboard: each card shows its answer with Space and is rated
 * with a digit, and the last one leads to the summary, which takes focus.
 */
export const QuickTenToTheEnd: Story = {
  args: {
    transport: storyTransport({
      summary: UNDER_WAY,
      deck: [CARDS.withSetup, CARDS.theory],
      reviews,
    }),
  },
  play: async ({ canvasElement }) => {
    reviews.length = 0
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Quick 10' }))

    await waitFor(() =>
      expect(canvas.getByRole('status')).toHaveTextContent('Quick 10: card 1 of 2'),
    )
    await expect(
      canvas.getByRole('heading', { level: 2, name: /Does this code compile/ }),
    ).toHaveFocus()
    await userEvent.keyboard(' ')
    await userEvent.keyboard('3')

    await waitFor(() =>
      expect(canvas.getByRole('status')).toHaveTextContent('Quick 10: card 2 of 2'),
    )
    await waitFor(() =>
      expect(canvas.getByRole('heading', { level: 2, name: /which expressions/ })).toHaveFocus(),
    )
    await userEvent.keyboard(' ')
    await userEvent.keyboard('1')

    const done = await canvas.findByRole('heading', { name: 'Quick 10 done' })
    await waitFor(() => expect(done).toHaveFocus())
    await expect(
      canvas.getByText('2 cards, 1 known. Each comes back when it is due.'),
    ).toBeVisible()
    await expect(reviews).toEqual([
      { questionId: CARDS.withSetup.question.id, rating: 'good' },
      { questionId: CARDS.theory.question.id, rating: 'again' },
    ])

    await userEvent.click(canvas.getByRole('button', { name: 'Back to topics' }))
    await expect(await canvas.findByRole('heading', { name: 'Topics' })).toBeVisible()
  },
}

const flags: FlagRequest[] = []

/** A card flagged as wrong is saved with the reason, the next card comes, and the summary counts it. */
export const FlagHidesTheCard: Story = {
  args: {
    transport: storyTransport({ deck: [CARDS.theory, CARDS.pitfall], flags }),
  },
  play: async ({ canvasElement }) => {
    flags.length = 0
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Quick 10' }))
    await userEvent.click(await canvas.findByRole('button', { name: 'Show answer' }))
    await userEvent.click(canvas.getByRole('button', { name: 'This answer is wrong' }))
    await userEvent.type(
      canvas.getByRole('textbox', { name: 'What is wrong with it?' }),
      'The code says otherwise.',
    )
    await userEvent.click(canvas.getByRole('button', { name: 'Hide this card' }))

    await waitFor(() =>
      expect(canvas.getByRole('status')).toHaveTextContent('Quick 10: card 2 of 2'),
    )
    await expect(flags).toEqual([
      { questionId: CARDS.theory.question.id, reason: 'The code says otherwise.' },
    ])
    await userEvent.click(canvas.getByRole('button', { name: 'Show answer' }))
    await userEvent.keyboard('3')
    await expect(
      await canvas.findByText(
        '1 card, 1 known. Each comes back when it is due. 1 card flagged as wrong, hidden from now on.',
      ),
    ).toBeVisible()
  },
}

const checks: AnswerCheckRequest[] = []

/**
 * Check my answer through the app: the card's question and what was written go to the check
 * route, the grade shows on the card, and the rating that follows is the owner's own.
 */
export const CheckMyAnswerOnACard: Story = {
  args: {
    transport: storyTransport({ deck: [CARDS.strictNullChecks], checks }),
  },
  play: async ({ canvasElement }) => {
    checks.length = 0
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Quick 10' }))
    await userEvent.type(
      await canvas.findByRole('textbox', { name: /Your answer/ }),
      'Null is assignable everywhere by default.',
    )
    await userEvent.click(canvas.getByRole('button', { name: 'Show answer' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Check my answer' }))

    await expect(await canvas.findByText('Score: 1 of 2')).toBeVisible()
    await expect(checks).toEqual([
      {
        questionId: CARDS.strictNullChecks.question.id,
        answer: 'Null is assignable everywhere by default.',
      },
    ])
    await userEvent.keyboard('3')
    await expect(
      await canvas.findByText('1 card, 1 known. Each comes back when it is due.'),
    ).toBeVisible()
  },
}

const answers: MockAnswerRequest[] = []

/**
 * A mock interview from the main screen to its summary: the first question is answered and so
 * is its follow-up, the second is skipped, and the summary takes focus.
 */
export const MockInterviewToTheSummary: Story = {
  args: { transport: storyTransport({ summary: UNDER_WAY, answers }) },
  play: async ({ canvasElement }) => {
    answers.length = 0
    const canvas = within(canvasElement)
    await expect(await canvas.findByText(/A graded answer costs about a cent/)).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Start a mock interview' }))

    await waitFor(() =>
      expect(canvas.getAllByRole('status')[0]).toHaveTextContent('Mock interview'),
    )
    await userEvent.type(await canvas.findByRole('textbox', { name: 'Your answer' }), 'Truthiness.')
    await userEvent.keyboard('{Control>}{Enter}{/Control}')
    await userEvent.type(
      await canvas.findByRole('textbox', { name: 'Your answer to the follow-up' }),
      '0 and NaN.',
    )
    await userEvent.keyboard('{Control>}{Enter}{/Control}')
    await userEvent.click(await canvas.findByRole('button', { name: 'Next question' }))
    await userEvent.click(await canvas.findByRole('button', { name: 'Skip' }))
    await userEvent.click(await canvas.findByRole('button', { name: 'See the summary' }))

    const done = await canvas.findByRole('heading', { name: 'Mock interview done' })
    await waitFor(() => expect(done).toHaveFocus())
    await expect(answers.map(({ step, answer }) => [step, answer])).toEqual([
      ['question', 'Truthiness.'],
      ['follow-up', '0 and NaN.'],
      ['question', ''],
    ])
    await userEvent.click(canvas.getByRole('button', { name: 'Back to topics' }))
    await expect(await canvas.findByRole('heading', { name: 'Topics' })).toBeVisible()
  },
}

/** Reflow at 320 CSS px (WCAG 1.4.10): nothing scrolls sideways but a code block's own box. */
export const Reflow320: Story = {
  parameters: {
    viewport: {
      options: {
        reflow: { name: '320 CSS px', type: 'mobile', styles: { width: '320px', height: '256px' } },
      },
    },
  },
  globals: { viewport: { value: 'reflow' } },
  args: { transport: storyTransport({ summary: UNDER_WAY, deck: [CARDS.withSetup] }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(window.innerWidth).toBe(320)
    await canvas.findByText(/cards due now/)
    await userEvent.click(canvas.getByRole('button', { name: /TypeScript: Handbook/ }))
    await expect(reflowProblems(canvasElement)).toEqual([])

    await userEvent.click(canvas.getByRole('button', { name: 'Quick 10' }))
    await userEvent.click(await canvas.findByRole('button', { name: 'Setup (hidden on the site)' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Show answer' }))
    await expect(reflowProblems(canvasElement)).toEqual([])
  },
}

/** A card's section of the docs, with its code and links, and a checked answer reflow too. */
export const PassageReflow320: Story = {
  ...Reflow320,
  args: { transport: storyTransport({ summary: UNDER_WAY, deck: [CARDS.pureComponent] }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(window.innerWidth).toBe(320)
    await userEvent.click(await canvas.findByRole('button', { name: 'Quick 10' }))
    await userEvent.type(
      await canvas.findByRole('textbox', { name: /Your answer/ }),
      'It skips re-renders for the same props and state.',
    )
    await userEvent.click(canvas.getByRole('button', { name: 'Show answer' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Check my answer' }))
    await canvas.findByText('Score: 1 of 2')
    await expect(reflowProblems(canvasElement)).toEqual([])
  },
}

/** The mock interview's grade and its summary reflow at 320 CSS px too. */
export const MockReflow320: Story = {
  ...Reflow320,
  args: { transport: storyTransport({ summary: UNDER_WAY }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(window.innerWidth).toBe(320)
    await userEvent.click(await canvas.findByRole('button', { name: 'Start a mock interview' }))
    await userEvent.type(await canvas.findByRole('textbox', { name: 'Your answer' }), 'Truthiness.')
    await userEvent.click(canvas.getByRole('button', { name: 'Submit answer' }))
    await canvas.findByRole('heading', { name: 'The answer from the docs' })
    await expect(reflowProblems(canvasElement)).toEqual([])

    await userEvent.click(canvas.getByRole('button', { name: 'End the interview' }))
    await canvas.findByRole('heading', { name: 'Mock interview done' })
    await expect(reflowProblems(canvasElement)).toEqual([])
  },
}
