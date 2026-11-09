import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { QuestionCard } from './QuestionCard.tsx'
import { CARDS } from './story-data.ts'

const meta = {
  title: 'Interview/QuestionCard',
  component: QuestionCard,
  args: {
    card: CARDS.compilerError,
    index: 1,
    total: 10,
    sourceTitle: 'TypeScript',
    onRate: fn(),
  },
} satisfies Meta<typeof QuestionCard>

export default meta
type Story = StoryObj<typeof meta>

/** A compiler question before the answer: the code as the site shows it, and the field. */
export const CompilerError: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('heading', { level: 2 })).toHaveFocus()
    await expect(canvas.getByText('Compiler: which error?')).toBeVisible()
    await expect(canvas.queryByRole('group', { name: 'How well did you know it?' })).toBeNull()
  },
}

/** The answer of a compiler question is the compiler's own output, with where it is in the docs. */
export const CompilerErrorAnswered: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Show answer' }))

    await expect(canvas.getByRole('heading', { name: 'Answer' })).toHaveFocus()
    await expect(canvas.getByText('TS2345')).toBeVisible()
    await expect(canvas.getByText(/Verified by the compiler: twoslash/)).toBeVisible()
    const link = canvas.getByRole('link', { name: /^The Basics/ })
    await expect(link).toHaveAttribute('href', CARDS.compilerError.question.citation.url)
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    await expect(canvas.getAllByRole('button', { name: /Again|Hard|Good|Easy/ })).toHaveLength(4)
  },
}

/**
 * The declarations the site hides above `---cut---` are one click away, so "does it compile?"
 * stays fair, and the default view matches the site. The disclosure keeps focus on its button.
 */
export const SetupHiddenOnTheSite: Story = {
  args: { card: CARDS.withSetup },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const setup = canvas.getByRole('button', { name: 'Setup (hidden on the site)' })
    await expect(setup).toHaveAttribute('aria-expanded', 'false')
    await expect(canvas.queryByText(/abstract getName/)).toBeNull()
    await expect(canvas.getByText(/class Derived extends Base/)).toBeVisible()

    await userEvent.click(setup)
    await expect(setup).toHaveAttribute('aria-expanded', 'true')
    await expect(setup).toHaveFocus()
    await expect(canvas.getByText(/abstract getName\(\): string;/)).toBeVisible()
  },
}

/** A type question's answer is the type TypeScript shows. */
export const TypeQuestionAnswered: Story = {
  args: { card: CARDS.compilerType },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Show answer' }))
    await expect(canvas.getByText('TypeScript shows')).toBeVisible()
  },
}

/** A theory question answers in words, with the quote it rests on. */
export const TheoryAnswered: Story = {
  args: { card: CARDS.theory },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Show answer' }))
    await expect(canvas.getByText(/we can use any expression in conditionals/)).toBeVisible()
    await expect(canvas.getByText(/Checked against its passage of the docs/)).toBeVisible()
  },
}

/**
 * The card the owner found wanting (ADR-0018): its link opens the section its quote is in, and the
 * card shows that section, which backs the whole answer, with the quote marked.
 */
export const QuoteSectionShown: Story = {
  args: { card: CARDS.strictNullChecks },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Show answer' }))
    const passage = within(canvas.getByRole('region', { name: 'From the docs' }))
    await expect(passage.getByText('The quote')).toBeVisible()
    await expect(passage.getByText(/spares/)).toBeVisible()
    // Its links lead to the docs, not into the app.
    await expect(passage.getByRole('link', { name: /strictNullChecks/ })).toHaveAttribute(
      'href',
      'https://www.typescriptlang.org/tsconfig#strictNullChecks',
    )
    await expect(
      canvas.getByRole('link', { name: 'The Basics > strictNullChecks' }),
    ).toHaveAttribute(
      'href',
      'https://www.typescriptlang.org/docs/handbook/2/basic-types.html#strictnullchecks',
    )
  },
}

/** A section of several blocks: only the one the quote is in is marked. */
export const QuoteInTheMiddle: Story = {
  args: { card: CARDS.pureComponent, sourceTitle: 'React' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Show answer' }))
    const passage = within(canvas.getByRole('region', { name: 'From the docs' }))
    await expect(passage.getAllByText('The quote')).toHaveLength(1)
    await expect(passage.getByText(/We recommend defining components as functions/)).toBeVisible()
    await expect(passage.getByText(/class Greeting extends PureComponent/)).toBeVisible()
    await expect(passage.getByRole('link', { name: /See how to migrate/ })).toHaveAttribute(
      'href',
      'https://react.dev/reference/react/PureComponent#alternatives',
    )
  },
}

/** A Pitfall question shows a block of the docs' code, never one a model wrote. */
export const PitfallAnswered: Story = {
  args: { card: CARDS.pitfall, sourceTitle: 'React' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/Avoid suppressing the linter/)).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Show answer' }))
    await expect(canvas.getByText(/high risk of introducing bugs/)).toBeVisible()
  },
}

/**
 * No shortcut fires while typing: Space and the digits type into the field, and Ctrl+Enter is
 * the one key there that shows the answer. Then 3 rates the card Good.
 */
export const KeysNeverFireWhileTyping: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const field = canvas.getByRole('textbox', { name: /Your answer/ })
    await userEvent.click(field)
    await userEvent.keyboard('TS 2345 on 1 2 3 4')

    await expect(field).toHaveValue('TS 2345 on 1 2 3 4')
    await expect(canvas.queryByRole('heading', { name: 'Answer' })).toBeNull()
    await expect(args.onRate).not.toHaveBeenCalled()

    await userEvent.keyboard('{Control>}{Enter}{/Control}')
    await expect(canvas.getByRole('heading', { name: 'Answer' })).toHaveFocus()
    await expect(canvas.getByText('TS 2345 on 1 2 3 4')).toBeVisible()

    await userEvent.keyboard('3')
    await expect(args.onRate).toHaveBeenCalledTimes(1)
    await expect(args.onRate).toHaveBeenCalledWith('good')
  },
}

/** Outside the field, Space shows the answer, and a digit before that does nothing. */
export const SpaceShowsTheAnswer: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('heading', { level: 2 })).toHaveFocus()

    await userEvent.keyboard('2')
    await expect(args.onRate).not.toHaveBeenCalled()

    await userEvent.keyboard(' ')
    await waitFor(() => expect(canvas.getByRole('heading', { name: 'Answer' })).toHaveFocus())
    await userEvent.keyboard('1')
    await expect(args.onRate).toHaveBeenCalledTimes(1)
    await expect(args.onRate).toHaveBeenCalledWith('again')
  },
}

/** Space on a button is that button's: on the setup disclosure it opens the setup, and no more. */
export const SpaceOnAButtonIsTheButtons: Story = {
  args: { card: CARDS.withSetup },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const setup = canvas.getByRole('button', { name: 'Setup (hidden on the site)' })
    await userEvent.tab()
    await expect(setup).toHaveFocus()

    await userEvent.keyboard(' ')
    await expect(setup).toHaveAttribute('aria-expanded', 'true')
    await expect(canvas.queryByRole('heading', { name: 'Answer' })).toBeNull()
  },
}

/** While a rating is on its way, the buttons wait and the keys do nothing. */
export const RatingOnItsWay: Story = {
  args: { busy: true },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Show answer' }))
    await expect(canvas.getByRole('group', { name: 'How well did you know it?' })).toBeDisabled()
    await userEvent.keyboard('4')
    await expect(args.onRate).not.toHaveBeenCalled()
  },
}

/**
 * "This answer is wrong", by the keyboard: the reason field takes focus, no shortcut fires while
 * typing in it, a blank reason is refused with a message, and Ctrl+Enter hides the card.
 */
export const FlagThisAnswer: Story = {
  args: { card: CARDS.theory, onFlag: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('button', { name: 'This answer is wrong' })).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: 'Show answer' }))
    await userEvent.click(canvas.getByRole('button', { name: 'This answer is wrong' }))

    const field = canvas.getByRole('textbox', { name: 'What is wrong with it?' })
    await expect(field).toHaveFocus()
    await userEvent.keyboard('{Control>}{Enter}{/Control}')
    await expect(field).toHaveAttribute('aria-invalid', 'true')
    await expect(canvas.getByText(/Say what is wrong/)).toBeVisible()
    await expect(args.onFlag).not.toHaveBeenCalled()

    await userEvent.keyboard('Says 1 thing 3 times, and 4 is wrong')
    await expect(args.onRate).not.toHaveBeenCalled()
    await expect(field).toHaveAttribute('aria-invalid', 'false')
    await userEvent.keyboard('{Control>}{Enter}{/Control}')
    await expect(args.onFlag).toHaveBeenCalledWith('Says 1 thing 3 times, and 4 is wrong')
  },
}

/** Cancel closes the form and gives focus back to the button that opened it; no digit rates meanwhile. */
export const FlagCancelled: Story = {
  args: { card: CARDS.pitfall, sourceTitle: 'React', onFlag: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Show answer' }))
    await userEvent.click(canvas.getByRole('button', { name: 'This answer is wrong' }))
    // With the form open, a digit rates nothing, even with focus on one of its buttons.
    canvas.getByRole('button', { name: 'Cancel' }).focus()
    await userEvent.keyboard('2')
    await expect(args.onRate).not.toHaveBeenCalled()
    await userEvent.click(canvas.getByRole('button', { name: 'Cancel' }))

    await waitFor(() =>
      expect(canvas.getByRole('button', { name: 'This answer is wrong' })).toHaveFocus(),
    )
    await expect(canvas.queryByRole('textbox', { name: 'What is wrong with it?' })).toBeNull()
    await expect(args.onFlag).not.toHaveBeenCalled()
    await userEvent.keyboard('2')
    await expect(args.onRate).toHaveBeenCalledWith('hard')
  },
}

/** Escape in the reason field cancels too, and gives focus back. */
export const FlagEscaped: Story = {
  args: { card: CARDS.theory, onFlag: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Show answer' }))
    await userEvent.click(canvas.getByRole('button', { name: 'This answer is wrong' }))
    await userEvent.keyboard('Not sure.{Escape}')

    await waitFor(() =>
      expect(canvas.getByRole('button', { name: 'This answer is wrong' })).toHaveFocus(),
    )
    await expect(args.onFlag).not.toHaveBeenCalled()
  },
}
