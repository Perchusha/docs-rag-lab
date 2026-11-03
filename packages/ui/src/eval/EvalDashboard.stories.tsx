import type { DashboardRun, DashboardRunComparison } from '@docs-rag-lab/contracts'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { evalFixtures } from '../fixtures.ts'
import type { EvalTransport } from '../lib/eval-transport.ts'
import { EvalDashboard } from './EvalDashboard.tsx'

function transport(overrides: Partial<EvalTransport> = {}): EvalTransport {
  return {
    run: (id) =>
      Promise.resolve(id === evalFixtures.baseline.id ? evalFixtures.baseline : evalFixtures.final),
    details: () => Promise.resolve(evalFixtures.details),
    compare: () => Promise.resolve(evalFixtures.compare),
    ...overrides,
  }
}

const meta = {
  title: 'Eval/EvalDashboard',
  component: EvalDashboard,
  args: {
    title: 'Eval: TypeScript docs assistant',
    runs: evalFixtures.runs,
    initial: evalFixtures.final,
    endpoints: { run: '/run', details: '/details', compare: '/compare' },
    transport: transport(),
  },
} satisfies Meta<typeof EvalDashboard>

export default meta
type Story = StoryObj<typeof meta>

const desktop = {
  parameters: {
    viewport: {
      options: {
        desktop: {
          name: '1280 by 800',
          type: 'desktop',
          styles: { width: '1280px', height: '800px' },
        },
      },
    },
  },
  globals: { viewport: { value: 'desktop' } },
} as const

const rowNamed = (canvasElement: HTMLElement, name: RegExp) => {
  const row = within(canvasElement).getByRole('rowheader', { name }).closest('tr')
  if (row === null) throw new Error(`no row ${String(name)}`)
  return row
}

/** The first screen answers three questions, with no number twice. */
export const FirstScreen: Story = {
  ...desktop,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Does hybrid find the right chunks more often?',
      'Does it give better answers, and does RAG help at all?',
      'Can these numbers be trusted?',
    ])

    // Plain labels, with the interval in the same cell as its number.
    const top8 = rowNamed(canvasElement, /Right chunk in top 8/)
    await expect(top8).toHaveTextContent('36 of 40 (77-96%)')
    await expect(top8).toHaveTextContent('Vector 2, Hybrid 2, tied 36, p = 1.00: Noise')
    const mrr = rowNamed(canvasElement, /How high it ranks \(MRR\)/)
    await expect(mrr).toHaveTextContent(/0\.751 \(0\.\d\d-0\.\d\d\)/)
    await expect(mrr).not.toHaveTextContent('~')
    await expect(mrr).toHaveTextContent('Not significant')

    const correct = rowNamed(canvasElement, /Fully correct/)
    await expect(correct).toHaveTextContent('may run high')
    await expect(correct).toHaveTextContent('36 of 40 (77-96%)')
    await expect(correct).toHaveTextContent('34 of 40 (71-93%)')
    await expect(correct).toHaveTextContent('Vector 2, Hybrid 0, tied 38')
    await expect(correct).toHaveTextContent('No RAG 1, Vector 1')
    await expect(correct).toHaveTextContent('none')

    const citations = rowNamed(canvasElement, /All citations hold/)
    await expect(citations).toHaveTextContent('cannot: no docs')
    await expect(citations).toHaveTextContent('38 of 40 (83-99%)')
    await expect(citations).toHaveTextContent('33 of 40 (68-91%)')
    await expect(citations).toHaveTextContent('Vector 5, Hybrid 0')
    await expect(citations).toHaveTextContent('5 questions differ')

    const grounded = rowNamed(canvasElement, /Correct and grounded/)
    await expect(grounded).toHaveTextContent(/Exploratory/i)
    await expect(grounded).toHaveTextContent('cannot, by design')
    await expect(grounded).toHaveTextContent('4 questions differ')

    await expect(canvas.getByText('Run to run (hybrid twice)')).toBeVisible()
    await expect(canvas.getByText(/All 3 disagreements are the judge scoring higher/)).toBeVisible()
    await expect(canvas.getByText(/0 questions stale/)).toBeVisible()
    await expect(canvas.getByText(/Calibrated, by the rule fixed in advance/)).toBeVisible()

    // Details stay closed.
    await expect(canvas.queryByRole('tablist')).toBeNull()
  },
}

/** Everything on the first screen fits 1280 by 800. */
export const FitsOneScreen: Story = {
  ...desktop,
  play: async () => {
    await expect(window.innerWidth).toBe(1280)
    await expect(window.innerHeight).toBe(800)
    await expect(document.documentElement.scrollHeight).toBeLessThanOrEqual(800)
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(1280)
  },
}

/**
 * The app's body sets no colours, unlike the one in these stories, so the page paints its own
 * from the edge of the window. Without it axe fails every dark view of the live page, and no
 * other story can see that.
 */
const paintsItsOwnPage = async (canvasElement: HTMLElement) => {
  const root = within(canvasElement).getByRole('main').parentElement
  if (root === null) throw new Error('no element around the page')
  const probe = document.createElement('div')
  probe.style.background = 'var(--color-bg)'
  root.append(probe)
  const expected = getComputedStyle(probe).backgroundColor
  probe.remove()
  await expect(expected).not.toBe('rgba(0, 0, 0, 0)')
  await expect(getComputedStyle(root).backgroundColor).toBe(expected)
  await expect(root.getBoundingClientRect().height).toBeGreaterThanOrEqual(window.innerHeight)
}

export const OwnBackground: Story = {
  ...desktop,
  play: async ({ canvasElement }) => {
    await paintsItsOwnPage(canvasElement)
  },
}

/** Three tab stops: the run, how it was calibrated, and the details. */
export const TabStops: Story = {
  ...desktop,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.tab()
    await expect(canvas.getByRole('combobox', { name: 'Run' })).toHaveFocus()
    await userEvent.tab()
    await expect(canvas.getByRole('button', { name: 'How this was calibrated' })).toHaveFocus()
    await userEvent.tab()
    await expect(canvas.getByRole('button', { name: /^Details/ })).toHaveFocus()
    await userEvent.tab()
    await expect(canvasElement.contains(document.activeElement)).toBe(false)
  },
}

/** The dots repeat the numbers, so a screen reader hears only the numbers. */
export const IntervalsAreHidden: Story = {
  ...desktop,
  play: async ({ canvasElement }) => {
    const graphics = canvasElement.querySelectorAll('[data-drl-interval]')
    await expect(graphics.length).toBeGreaterThan(0)
    for (const graphic of graphics) {
      await expect(graphic.getAttribute('aria-hidden')).toBe('true')
    }
    // A share at 36 of 40 sits at 90%, inside its whiskers.
    const row = rowNamed(canvasElement, /Right chunk in top 8/)
    const dot = row.querySelector<HTMLElement>('[data-shape]')
    await expect(dot?.style.insetInlineStart).toBe('90%')
    // Each column keeps one shape in both sections.
    const shapes = (name: RegExp) =>
      [...rowNamed(canvasElement, name).querySelectorAll<HTMLElement>('[data-shape]')].map(
        (element) => element.dataset.shape,
      )
    await expect(shapes(/Right chunk in top 8/)).toEqual(['square', 'diamond'])
    await expect(shapes(/Fully correct/)).toEqual(['circle', 'square', 'diamond'])
    // Nothing is placed for a row with no numbers, and it claims no run-to-run measure.
    await expect(shapes(/Time and cost/)).toEqual([])
    await expect(rowNamed(canvasElement, /Time and cost/)).not.toHaveTextContent('not measured')
    // The cell of the graphic goes with its header, so each other cell keeps its own header.
    for (const table of canvasElement.querySelectorAll('table')) {
      const heard = (cells: NodeListOf<Element>) =>
        [...cells].filter((cell) => cell.getAttribute('aria-hidden') !== 'true').length
      const headers = heard(table.querySelectorAll('thead th'))
      for (const row of table.querySelectorAll('tbody tr')) {
        await expect(heard(row.querySelectorAll('th, td'))).toBe(headers)
      }
    }
  },
}

/** A run with no answers has no second question, and no judge. */
export const RunWithoutAnswers: Story = {
  args: { initial: evalFixtures.baseline },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getAllByRole('heading', { level: 2 })).toHaveLength(2)
    await expect(canvas.getByText(/This run has no answers/)).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'How this was calibrated' })).toBeNull()
    await expect(canvas.queryByText('may run high')).toBeNull()
  },
}

/** The first report, under the old prompt: the labels say it missed the bar. */
export const NotCalibrated: Story = {
  args: { initial: evalFixtures.first },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Not calibrated for these prompts.')).toBeVisible()
    await expect(canvas.getByText(/correctness 10 of 12 \(55-95%\)/)).toBeVisible()
    await expect(canvas.getByText(/All 3 disagreements/)).toBeVisible()
  },
}

function trustChange(change: (run: DashboardRun) => void): DashboardRun {
  const run = structuredClone(evalFixtures.final)
  change(run)
  return run
}

/** A dimension nobody labelled under this prompt says so, rather than passing quietly. */
export const NotLabelled: Story = {
  args: {
    initial: trustChange(({ trust }) => {
      if (trust.judge === null) return
      trust.judge.calibrated = false
      trust.judge.agreement = trust.judge.agreement.filter(
        ({ dimension }) => dimension !== 'correctness',
      )
    }),
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(/correctness not labelled/)).toBeVisible()
  },
}

/** No record of a re-run says "not checked", and never implies a pass. */
export const NotChecked: Story = {
  args: {
    initial: trustChange(({ trust }) => {
      trust.verify = null
    }),
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Not checked.')).toBeVisible()
  },
}

/** The index moved on, a question went stale, and two need another read. */
export const IndexMovedOn: Story = {
  args: {
    initial: trustChange(({ trust }) => {
      trust.indexDocsSha = 'aaaaaaaabbbb'
      trust.stale = ['ts-0001']
      trust.review = ['ts-0002', 'ts-0003']
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/the index is now at aaaaaaaa/)).toBeVisible()
    await expect(canvas.getByText(/1 question stale, 2 to re-read/)).toBeVisible()
  },
}

/** No index yet, which the dashboard needs nothing from but this sentence. */
export const NoIndex: Story = {
  args: {
    initial: trustChange(({ trust }) => {
      trust.indexDocsSha = null
    }),
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(/there is no index to compare with/)).toBeVisible()
  },
}

/** A source with no named run says what to do. */
export const NoRuns: Story = {
  args: { runs: [], initial: undefined },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(/no named run yet/)).toBeVisible()
    await paintsItsOwnPage(canvasElement)
  },
}

/** Rounds behind the disclosure, with the labels that decide nothing marked. */
export const HowCalibrated: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const button = canvas.getByRole('button', { name: 'How this was calibrated' })
    await expect(button).toHaveAttribute('aria-expanded', 'false')
    button.focus()
    await userEvent.keyboard('{Enter}')
    await expect(button).toHaveAttribute('aria-expanded', 'true')
    await expect(canvas.getByRole('group', { name: 'Calibration rounds' })).toBeVisible()
    await expect(canvas.getByText('Fresh round')).toBeVisible()
    await expect(canvas.getAllByText('Not blind').length).toBeGreaterThan(0)
    await expect(canvas.getAllByText('decides nothing').length).toBeGreaterThan(0)
  },
}

/** The address asked for a run the store does not have, so the page says what it shows instead. */
export const UnknownRunAsked: Story = {
  args: { missingRun: 'typo' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('alert')).toHaveTextContent(
      'There is no run "typo", so this shows answers-regraded.',
    )
    await userEvent.selectOptions(
      canvas.getByRole('combobox', { name: 'Run' }),
      evalFixtures.baseline.id,
    )
    await waitFor(() => expect(canvas.queryByRole('alert')).toBeNull())
  },
}

/** A report that cannot be read is named, and the others still show. */
export const UnreadableRun: Story = {
  args: { unreadableRuns: ['2026-11-02-abcdef12-broken'] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('alert')).toHaveTextContent(
      'Could not read these reports: 2026-11-02-abcdef12-broken.',
    )
    await expect(canvas.getAllByRole('heading', { level: 2 })).toHaveLength(3)
  },
}

/** Nothing readable is not the same as nothing yet. */
export const OnlyUnreadableRuns: Story = {
  args: { runs: [], initial: undefined, unreadableRuns: ['2026-11-02-abcdef12-broken'] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('alert')).toHaveTextContent('2026-11-02-abcdef12-broken')
    await expect(canvas.queryByText(/no named run yet/)).toBeNull()
  },
}

/** A calibration file that cannot be read means not calibrated, and says which. */
export const UnreadableCalibration: Story = {
  args: {
    initial: trustChange(({ trust }) => {
      if (trust.judge === null) return
      trust.judge.calibrated = false
      trust.judge.unreadable = ['2026-11-03-abcdef12-answers-calibration']
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Not calibrated for these prompts.')).toBeVisible()
    await expect(canvas.getByText(/Could not read 2026-11-03-abcdef12/)).toBeVisible()
  },
}

/** Choosing a run announces it, and the page changes with it. */
export const SwitchRun: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const picker = canvas.getByRole('combobox', { name: 'Run' })
    await userEvent.selectOptions(picker, evalFixtures.baseline.id)
    await waitFor(() =>
      expect(canvas.getByRole('status')).toHaveTextContent('Showing the run baseline.'),
    )
    await expect(canvas.getAllByRole('heading', { level: 2 })).toHaveLength(2)
    await expect(picker).toHaveValue(evalFixtures.baseline.id)
  },
}

/** A run that does not load says so, keeps the page, and does not pretend to have moved. */
export const SwitchRunFails: Story = {
  args: {
    transport: transport({ run: () => Promise.reject(new Error('there is no run "x"')) }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const picker = canvas.getByRole('combobox', { name: 'Run' })
    await userEvent.selectOptions(picker, evalFixtures.baseline.id)
    await expect(await canvas.findByRole('alert')).toHaveTextContent('there is no run "x"')
    await expect(picker).toHaveValue(evalFixtures.final.id)
    await expect(canvas.getAllByRole('heading', { level: 2 })).toHaveLength(3)
  },
}

/** A slow answer to an earlier choice never replaces the run the picker now names. */
const answerByHand = () => {
  const waiting = new Map<string, () => void>()
  return {
    release: (id: string) => {
      waiting.get(id)?.()
    },
    transport: transport({
      run: (id) =>
        new Promise<DashboardRun>((resolve) => {
          waiting.set(id, () => {
            resolve(id === evalFixtures.baseline.id ? evalFixtures.baseline : evalFixtures.first)
          })
        }),
    }),
  }
}
const outOfOrder = answerByHand()

export const SwitchRunOutOfOrder: Story = {
  args: { transport: outOfOrder.transport },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const picker = canvas.getByRole('combobox', { name: 'Run' })
    await userEvent.selectOptions(picker, evalFixtures.first.id)
    await userEvent.selectOptions(picker, evalFixtures.baseline.id)
    outOfOrder.release(evalFixtures.baseline.id)
    await waitFor(() =>
      expect(canvas.getByRole('status')).toHaveTextContent('Showing the run baseline.'),
    )
    await expect(canvas.getAllByRole('heading', { level: 2 })).toHaveLength(2)

    // The earlier answer arrives last, and changes nothing.
    outOfOrder.release(evalFixtures.first.id)
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })
    await expect(picker).toHaveValue(evalFixtures.baseline.id)
    await expect(canvas.getAllByRole('heading', { level: 2 })).toHaveLength(2)
    await expect(canvas.getByRole('status')).toHaveTextContent('Showing the run baseline.')
  },
}

const openDetails = async (canvasElement: HTMLElement) => {
  const canvas = within(canvasElement)
  await userEvent.click(canvas.getByRole('button', { name: /^Details/ }))
  return canvas.findByRole('tablist', { name: 'Details' })
}

/** Details open on tags, and the arrow keys walk the tabs. */
export const DetailsTabs: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await openDetails(canvasElement)
    await expect(canvas.getByRole('heading', { name: 'Fully correct, by tag' })).toBeVisible()
    await expect(canvas.getByRole('heading', { name: 'Correctness score, 0 to 2' })).toBeVisible()
    await expect(canvas.getAllByText('Too few to say').length).toBeGreaterThan(0)
    // A score of 1.850 sits on a scale of 0 to 2, on the track, and the scale says so.
    const score = canvas
      .getByRole('heading', { name: 'Correctness score, 0 to 2' })
      .closest('section')
    await expect(score?.querySelector('thead th[aria-hidden="true"]')).toHaveTextContent('0 to 2')
    const dot = score?.querySelector<HTMLElement>('[data-shape]')
    await expect(dot?.style.insetInlineStart).toBe('92.5%')
    await expect(
      canvas.getByRole('heading', { name: 'Fully correct, by tag' }).closest('section'),
    ).toHaveTextContent('may run high')

    canvas.getByRole('tab', { name: 'Per tag' }).focus()
    await userEvent.keyboard('{ArrowRight}')
    await expect(canvas.getByRole('tab', { name: 'Per question' })).toHaveFocus()
    await userEvent.keyboard('{End}')
    await expect(canvas.getByRole('tab', { name: 'Runs' })).toHaveFocus()
    await userEvent.keyboard('{Home}')
    await expect(canvas.getByRole('tab', { name: 'Per tag' })).toHaveFocus()
  },
}

/** Only the questions that differ first, then all of them. */
export const PerQuestion: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await openDetails(canvasElement)
    await userEvent.click(canvas.getByRole('tab', { name: 'Per question' }))
    const toggle = canvas.getByRole('button', { name: /^Show all/ })
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await expect(canvas.getByText(/where strategies or rows differ/)).toBeVisible()
    await expect(canvas.getByText(/The judge's grades: may run high/)).toBeVisible()
    const differing = canvas.getAllByRole('rowheader').length
    await userEvent.click(toggle)
    await expect(canvas.getAllByRole('rowheader').length).toBeGreaterThan(differing)
    await expect(canvas.getByText(/All 45 questions/)).toBeVisible()
    // ts-0024 is why M9 has a candidate: no RAG answers, and both RAG rows refuse.
    const row = rowNamed(canvasElement, /ts-0024/)
    await expect(row).toHaveTextContent('Fully correct')
    await expect(row).toHaveTextContent('Refused')
  },
}

/** The cited chunks say they wait for review, and that none was added. */
export const CitedChunks: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await openDetails(canvasElement)
    await userEvent.click(canvas.getByRole('tab', { name: 'Cited chunks (52)' }))
    await expect(canvas.getByText(/None is added automatically/)).toBeVisible()
    await expect(canvas.getByRole('group', { name: 'Cited chunks' })).toBeVisible()
  },
}

/** Details that do not load say so. */
export const DetailsFail: Story = {
  args: { transport: transport({ details: () => Promise.reject(new Error('no such file')) }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /^Details/ }))
    await expect(await canvas.findByRole('alert')).toHaveTextContent('no such file')
  },
}

const openRuns = async (canvasElement: HTMLElement) => {
  const canvas = within(canvasElement)
  await openDetails(canvasElement)
  await userEvent.click(canvas.getByRole('tab', { name: 'Runs' }))
  await userEvent.click(canvas.getByRole('button', { name: 'Compare' }))
}

/** Two runs side by side, with what else differs first. */
export const CompareRuns: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await openRuns(canvasElement)
    await expect(await canvas.findByText('What else differs:')).toBeVisible()
    await expect(canvas.getByText(/identity\.indexSchema/)).toBeVisible()
    await expect(canvas.getByRole('group', { name: 'Ranks that moved' })).toBeVisible()
  },
}

const refused: DashboardRunComparison = {
  comparable: false,
  reason:
    'These runs used golden set versions 1 and 2, and numbers from two versions are never compared.',
}

/** Two set versions are never compared. */
export const CompareRefused: Story = {
  args: { transport: transport({ compare: () => Promise.resolve(refused) }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await openRuns(canvasElement)
    await expect(await canvas.findByRole('alert')).toHaveTextContent('never compared')
  },
}

/** At 320 px nothing scrolls sideways but the tables, which the keyboard can reach. */
export const Reflow320: Story = {
  parameters: {
    viewport: {
      options: {
        reflow: { name: '320 CSS px', type: 'mobile', styles: { width: '320px', height: '640px' } },
      },
    },
  },
  globals: { viewport: { value: 'reflow' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(window.innerWidth).toBe(320)
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320)

    // The tables do not fit, so they scroll in their own boxes and take focus.
    const region = canvas.getByRole('group', {
      name: 'Does it give better answers, and does RAG help at all?',
    })
    await waitFor(() => expect(region).toHaveAttribute('tabindex', '0'))
    await expect(region.scrollWidth).toBeGreaterThan(region.clientWidth)

    // The graphic keeps its width, and its dots stay inside their track.
    const graphic = region.querySelector<HTMLElement>('[data-drl-interval]')
    await expect(graphic?.getBoundingClientRect().width).toBeGreaterThan(50)

    await userEvent.tab()
    await expect(canvas.getByRole('combobox', { name: 'Run' })).toHaveFocus()
    await userEvent.tab()
    await expect(
      canvas.getByRole('group', { name: 'Does hybrid find the right chunks more often?' }),
    ).toHaveFocus()
    await userEvent.tab()
    await expect(region).toHaveFocus()
    await userEvent.keyboard('{ArrowRight}')

    // Opening everything keeps the rule.
    await userEvent.click(canvas.getByRole('button', { name: /^Details/ }))
    await canvas.findByRole('tablist', { name: 'Details' })
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320)
  },
}
