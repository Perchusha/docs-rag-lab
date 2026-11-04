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

    // Details stay closed, and they follow the trust section rather than being part of it.
    await expect(canvas.queryByRole('tablist')).toBeNull()
    const details = canvas.getByRole('button', { name: /^Details/ })
    await expect(details.closest('section')).toBeNull()
    await expect(details.previousElementSibling).toBe(
      canvas.getByRole('region', { name: 'Can these numbers be trusted?' }),
    )
  },
}

/** The three sections fit 1280 by 800. The Details button is no section, and may sit just below. */
const sectionsFit = async (canvasElement: HTMLElement) => {
  await expect(window.innerWidth).toBe(1280)
  await expect(window.innerHeight).toBe(800)
  const sections = [...canvasElement.querySelectorAll('section')]
  await expect(sections).toHaveLength(3)
  for (const section of sections) {
    await expect(section.getBoundingClientRect().bottom).toBeLessThanOrEqual(800)
  }
  await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(1280)
}

export const FitsOneScreen: Story = {
  ...desktop,
  play: async ({ canvasElement }) => {
    await sectionsFit(canvasElement)
  },
}

/** A report under another prompt says more on the first screen, and still fits. */
export const FitsOneScreenNotCalibrated: Story = {
  ...desktop,
  args: { initial: evalFixtures.first },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText(/not calibrated for these prompts, so/),
    ).toBeVisible()
    await sectionsFit(canvasElement)
  },
}

/**
 * The page paints its own background from the edge of the window, as the chat does, whatever the
 * body it is given. The body here has the page colours, so no other story can see this.
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

const rerankArgs = {
  runs: [
    {
      id: evalFixtures.rerank.id,
      name: evalFixtures.rerank.name,
      createdAt: evalFixtures.rerank.createdAt,
      sha: evalFixtures.rerank.repoSha.slice(0, 8),
      hasAnswers: true,
    },
    ...evalFixtures.runs,
  ],
  initial: evalFixtures.rerank,
  transport: transport({
    run: () => Promise.resolve(evalFixtures.rerank),
    details: () => Promise.resolve(evalFixtures.detailsRerank),
  }),
}

/** With the reranker's rows: three columns, the rows that decide, and what to read them against. */
export const RerankFirstScreen: Story = {
  ...desktop,
  args: rerankArgs,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Does rerank find the right chunks higher?',
      'Does that reach the answers?',
      'Can these numbers be trusted?',
    ])
    await expect(canvas.queryByRole('columnheader', { name: /No RAG/ })).toBeNull()
    await expect(canvas.queryByRole('columnheader', { name: /Vector/ })).toBeNull()
    await expect(canvas.getAllByRole('columnheader', { name: /Rerank \+ contexts/ })).toHaveLength(
      2,
    )

    const first = rowNamed(canvasElement, /Right chunk first/)
    await expect(first).toHaveTextContent('19 of 40 (33-63%)')
    await expect(first).toHaveTextContent('31 of 40 (62-88%)')
    await expect(first).toHaveTextContent('33 of 40 (68-91%)')
    await expect(first).toHaveTextContent('Rerank 12 : 0, p < 0.01: Better')
    await expect(first).toHaveTextContent('+ contexts 14 : 0, p < 0.01: Better')
    await expect(rowNamed(canvasElement, /Right chunk in top 8/)).toHaveTextContent(
      'Rerank 3 : 0, p = 0.25: Not significant',
    )
    await expect(canvas.getByText(/^Rerank better on the right chunk first/)).toHaveTextContent(
      'Rerank is hybrid, then rerank-3 over its top 20.',
    )

    const correct = rowNamed(canvasElement, /Fully correct/)
    await expect(correct).toHaveTextContent('may run high')
    await expect(correct).toHaveTextContent('34 of 40 (71-93%)')
    await expect(correct).toHaveTextContent('37 of 40 (80-97%)')
    await expect(correct).toHaveTextContent('Rerank 3 : 1, p = 0.63: Noise')
    await expect(correct).toHaveTextContent('+ contexts 3 : 0, p = 0.25: Not significant')
    await expect(correct).toHaveTextContent('0, 0, 0')
    await expect(rowNamed(canvasElement, /All citations hold/)).toHaveTextContent('5, 5, 5')
    await expect(rowNamed(canvasElement, /Wrongly refused/)).toHaveTextContent('0, 0, 1')
    await expect(rowNamed(canvasElement, /Correct and grounded/)).toHaveTextContent(/Exploratory/i)
    await expect(canvas.getByText('Run to run (each twice)')).toBeVisible()
    await expect(canvas.queryByRole('rowheader', { name: /Cites the right passage/ })).toBeNull()
    await expect(canvas.queryByRole('rowheader', { name: /Refused rightly/ })).toBeNull()
    await expect(canvas.queryByRole('rowheader', { name: /Time and cost/ })).toBeNull()

    await expect(
      canvas.getByText(
        'No difference from hybrid holds up, and none between rerank and rerank + contexts.',
      ),
    ).toBeVisible()
    await expect(
      canvas.getByText('Without docs: 36 of 40 fully correct (77-96%), may run high.'),
    ).toBeVisible()
    await expect(
      canvas.getByText(
        'The app stays on hybrid, because the retrieval gain did not reach the answers (ADR-0014).',
      ),
    ).toBeVisible()
    await expect(
      canvas.getByText(
        'Rerank + contexts read the contextual index: claude-haiku-5-5:75010bc9e7d5.',
      ),
    ).toBeVisible()
    await expect(
      canvas.getByRole('button', {
        name: 'Details: all rows, per tag, per question, cited chunks, runs',
      }),
    ).toBeVisible()
  },
}

export const RerankFitsOneScreen: Story = {
  ...desktop,
  args: rerankArgs,
  play: async ({ canvasElement }) => {
    await sectionsFit(canvasElement)
  },
}

/** The ADR is named in plain text, so that the two added lines add no tab stop. */
export const RerankTabStops: Story = {
  ...desktop,
  args: rerankArgs,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('link')).toBeNull()
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

/** Each column keeps one shape, so nothing depends on colour, with five columns in all. */
export const RerankShapes: Story = {
  ...desktop,
  args: rerankArgs,
  play: async ({ canvasElement }) => {
    const shapes = [
      ...rowNamed(canvasElement, /Fully correct/).querySelectorAll<HTMLElement>('[data-shape]'),
    ].map((element) => element.dataset.shape)
    await expect(shapes).toEqual(['diamond', 'up', 'down'])
  },
}

/** What the first screen leaves out comes first behind it: every row, with every comparison. */
export const RerankAllRows: Story = {
  ...desktop,
  args: rerankArgs,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /^Details/ }))
    const tab = await canvas.findByRole('tab', { name: 'All rows' })
    await expect(tab).toHaveAttribute('aria-selected', 'true')
    const panel = within(canvas.getByRole('tabpanel'))
    await expect(panel.getAllByRole('columnheader', { name: /No RAG/ })).toHaveLength(1)
    const rows = panel.getAllByRole('rowheader')
    const named = (name: RegExp) => {
      const row = rows.find((candidate) => name.test(candidate.textContent))?.closest('tr')
      if (row === null || row === undefined) throw new Error(`no row ${String(name)}`)
      return row
    }
    await expect(named(/All citations hold/)).toHaveTextContent('-, -, 5, 5, 5')
    await expect(named(/Fully correct/)).toHaveTextContent('Hybrid 1, Rerank 3, tied 36')
    await expect(named(/Refused rightly/)).toHaveTextContent('5 of 5')
    await expect(named(/Time and cost/)).toHaveTextContent('search not included')
    await expect(panel.getByText(/What RAG adds is grounding/)).toBeVisible()
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

const systemColour = (name: 'Canvas' | 'CanvasText' | 'GrayText'): string => {
  const probe = document.createElement('div')
  probe.style.setProperty('forced-color-adjust', 'none')
  probe.style.color = name
  document.body.append(probe)
  const { color } = getComputedStyle(probe)
  probe.remove()
  return color
}

/**
 * Forced colours drop every background, which is all that the marks are. Only the forced-colors
 * project runs this (vitest.config.ts), in a palette per colour scheme, so a hard-coded fill
 * cannot pass.
 */
export const IntervalsInForcedColors: Story = {
  ...desktop,
  tags: ['forced-colors'],
  play: async ({ canvasElement }) => {
    await expect(window.matchMedia('(forced-colors: active)').matches).toBe(true)
    const text = systemColour('CanvasText')
    const page = systemColour('Canvas')
    await expect(text).not.toBe(page)

    const graphic = rowNamed(canvasElement, /Fully correct/).querySelector('[data-drl-interval]')
    const all = (selector: string) => [...(graphic?.querySelectorAll<HTMLElement>(selector) ?? [])]
    const painted = (element: HTMLElement) => {
      const { width, height } = element.getBoundingClientRect()
      return width > 0 && height > 0
    }

    const tracks = all(':scope > span')
    await expect(tracks).toHaveLength(3)
    for (const track of tracks) {
      await expect(getComputedStyle(track).backgroundImage).toContain(systemColour('GrayText'))
    }
    const whiskers = all(':scope > span > span:not([data-shape])')
    await expect(whiskers).toHaveLength(3)
    for (const whisker of whiskers) {
      await expect(painted(whisker)).toBe(true)
      await expect(getComputedStyle(whisker).backgroundColor).toBe(text)
      await expect(getComputedStyle(whisker).opacity).toBe('1')
    }
    const shape = (name: string) => {
      const [dot] = all(`[data-shape='${name}']`)
      if (dot === undefined) throw new Error(`no ${name}`)
      return dot
    }
    for (const name of ['square', 'diamond']) {
      await expect(painted(shape(name))).toBe(true)
      await expect(getComputedStyle(shape(name)).backgroundColor).toBe(text)
    }
    await expect(getComputedStyle(shape('circle')).backgroundColor).toBe(page)
    await expect(getComputedStyle(shape('circle')).borderTopColor).toBe(text)
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
    await expect(
      within(canvasElement).getByText(/no index could be read to compare with/),
    ).toBeVisible()
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
      'There is no run "typo", so this shows final.',
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

/** A long run name in the picker does not push the page sideways, whatever the font's width. */
export const Reflow320LongName: Story = {
  args: {
    runs: evalFixtures.runs.map((run) => ({
      ...run,
      name: `${run.name}-with-a-name-long-enough-to-pass-the-width-of-any-small-screen`,
    })),
  },
  parameters: {
    viewport: {
      options: {
        reflow: { name: '320 CSS px', type: 'mobile', styles: { width: '320px', height: '640px' } },
      },
    },
  },
  globals: { viewport: { value: 'reflow' } },
  play: async () => {
    await expect(window.innerWidth).toBe(320)
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320)
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
