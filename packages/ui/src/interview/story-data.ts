// What the interview app's stories show (ADR-0018): an overview with the real topic names of both
// sources, decks of the fixture questions, and a transport that answers from them with no network.
// Not part of the public entry.
import type {
  FlagRequest,
  PracticeCard,
  PracticeOverview,
  PracticeSummary,
  ReviewRequest,
  TopicGroup,
  TopicProgress,
} from '@docs-rag-lab/contracts'

import { interviewQuestions } from '../fixtures.ts'
import type { InterviewTransport } from '../lib/interview-transport.ts'

export const SOURCES = [
  { id: 'typescript', title: 'TypeScript' },
  { id: 'react', title: 'React' },
] as const

export const SOURCE_TITLES: Readonly<Record<string, string>> = {
  typescript: 'TypeScript',
  react: 'React',
}

const topic = (
  source: string,
  group: string,
  id: string,
  title: string,
  progress: Partial<TopicProgress> = {},
): TopicProgress => ({
  source,
  group,
  id,
  title,
  questions: 12,
  seen: 0,
  good: 0,
  due: 0,
  ...progress,
})

export const GROUPS: TopicGroup[] = [
  {
    source: 'typescript',
    group: 'Handbook',
    topics: [
      topic('typescript', 'Handbook', 'handbook-v2/Basics', 'The Basics', {
        seen: 5,
        good: 4,
        due: 1,
      }),
      topic('typescript', 'Handbook', 'handbook-v2/Classes', 'Classes', { questions: 34 }),
      topic('typescript', 'Handbook', 'handbook-v2/Narrowing', 'Narrowing', {
        questions: 31,
        seen: 12,
        good: 9,
      }),
      topic('typescript', 'Handbook', 'handbook-v2/Object Types', 'Object Types', {
        questions: 29,
      }),
      topic('typescript', 'Handbook', 'handbook-v2/Type Manipulation/Generics', 'Generics', {
        questions: 8,
      }),
    ],
  },
  {
    source: 'typescript',
    group: 'Reference',
    topics: [
      topic('typescript', 'Reference', 'reference/Utility Types', 'Utility Types', {
        questions: 50,
      }),
      topic('typescript', 'Reference', 'reference/Type Inference', 'Type Inference', {
        questions: 6,
      }),
    ],
  },
  {
    source: 'typescript',
    group: 'Compiler options',
    topics: [
      topic('typescript', 'Compiler options', 'compiler-options', 'Compiler options', {
        questions: 22,
      }),
    ],
  },
  {
    source: 'react',
    group: 'Learn',
    topics: [
      topic('react', 'Learn', 'learn/synchronizing-with-effects', 'Synchronizing with Effects'),
      topic('react', 'Learn', 'learn/state-as-a-snapshot', 'State as a Snapshot'),
    ],
  },
  {
    source: 'react',
    group: 'Reference',
    topics: [
      topic('react', 'Reference', 'reference/hooks', 'Hooks', {
        questions: 40,
        seen: 3,
        good: 1,
        due: 2,
      }),
      topic('react', 'Reference', 'reference/react-dom', 'React DOM', { questions: 20 }),
    ],
  },
]

export const FIRST_RUN: PracticeSummary = { questions: 329, seen: 0, good: 0, due: 0, reviews: 0 }
export const UNDER_WAY: PracticeSummary = {
  questions: 329,
  seen: 20,
  good: 14,
  due: 3,
  reviews: 31,
}

export function overviewOf(
  summary: PracticeSummary,
  sources: readonly string[] = ['typescript', 'react'],
): PracticeOverview {
  return {
    sources: sources.map((id) => ({ id, questions: id === 'typescript' ? 329 : 60 })),
    groups: GROUPS.filter((group) => sources.includes(group.source)),
    summary,
  }
}

const card = (question: PracticeCard['question'], topicTitle: string): PracticeCard => ({
  question,
  state: 'new',
  topicTitle,
})

export const CARDS = {
  compilerError: card(interviewQuestions.compilerError, 'The Basics'),
  withSetup: card(interviewQuestions.withSetup, 'Classes'),
  compilerType: card(interviewQuestions.compilerType, 'Narrowing'),
  theory: card(interviewQuestions.theory, 'Narrowing'),
  pitfall: card(interviewQuestions.pitfall, 'Hooks'),
}

/** Answers from the data above at once, and records each review it was sent. */
export function storyTransport(
  options: {
    summary?: PracticeSummary
    deck?: PracticeCard[]
    reviews?: ReviewRequest[]
    flags?: FlagRequest[]
  } = {},
): InterviewTransport {
  const deck = options.deck ?? Object.values(CARDS)
  return {
    overview: (sources) => Promise.resolve(overviewOf(options.summary ?? FIRST_RUN, sources)),
    deck: (sources, topicOf) =>
      Promise.resolve({
        cards: deck.filter(
          ({ question }) =>
            sources.includes(question.source) &&
            (topicOf === undefined || question.topicId === topicOf.id),
        ),
      }),
    review: (request) => {
      options.reviews?.push(request)
      return Promise.resolve({ questionId: request.questionId, due: '2026-11-11T12:00:00.000Z' })
    },
    flag: (request) => {
      options.flags?.push(request)
      return Promise.resolve({
        questionId: request.questionId,
        flaggedAt: '2026-11-09T12:00:00.000Z',
      })
    },
  }
}

const WIDE_BOX = '[role="group"][tabindex="0"]'

/**
 * Everything that would make the page scroll sideways at the current width (WCAG 1.4.10), as
 * DocsAssistant's Reflow320 story checks it: only a code block's own box may be wider.
 */
export function reflowProblems(root: HTMLElement): string[] {
  const page = document.documentElement
  const problems: string[] = []
  if (page.scrollWidth > page.clientWidth) {
    problems.push(`the page scrolls: ${String(page.scrollWidth)} in ${String(page.clientWidth)}`)
  }
  for (const element of root.querySelectorAll('*')) {
    const box = element.closest(WIDE_BOX)
    if (box !== null && box !== element) continue
    const right = element.getBoundingClientRect().right
    if (right > page.clientWidth + 0.5) {
      problems.push(
        `<${element.tagName.toLowerCase()}> "${element.textContent.slice(0, 40)}" ends at ${right.toFixed(0)}`,
      )
    }
  }
  return problems
}
