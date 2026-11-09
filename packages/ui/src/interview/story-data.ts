// What the interview app's stories show (ADR-0018): an overview with the real topic names of both
// sources, decks of the fixture questions, and a transport that answers from them with no network.
// Not part of the public entry.
import type {
  AnswerCheck,
  AnswerCheckRequest,
  BankQuestion,
  FlagRequest,
  MockAnswerRequest,
  MockGrade,
  MockQuestion,
  MockSession,
  MockSummary,
  PracticeCard,
  PracticeOverview,
  PracticeSummary,
  ReviewRequest,
  TopicGroup,
  TopicProgress,
} from '@docs-rag-lab/contracts'

import { interviewPassageCards, interviewQuestions } from '../fixtures.ts'
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

/** A generated question with the passage the app shows for it. */
function passageCard(index: number, topicTitle: string): PracticeCard {
  const found = interviewPassageCards[index]
  if (found === undefined) throw new Error(`no passage card at ${String(index)}`)
  return { ...card(found.question, topicTitle), passage: found.passage }
}

export const CARDS = {
  compilerError: card(interviewQuestions.compilerError, 'The Basics'),
  withSetup: card(interviewQuestions.withSetup, 'Classes'),
  compilerType: card(interviewQuestions.compilerType, 'Narrowing'),
  theory: card(interviewQuestions.theory, 'Narrowing'),
  pitfall: card(interviewQuestions.pitfall, 'Hooks'),
  strictNullChecks: passageCard(0, 'The Basics'),
  pureComponent: passageCard(1, 'PureComponent'),
}

const asked = (question: BankQuestion, topicTitle: string): MockQuestion => ({
  id: question.id,
  source: question.source,
  kind: question.kind,
  topicTitle,
  prompt: question.prompt,
  ...(question.code === undefined ? {} : { code: question.code }),
})

/** A mock interview of the two generated fixture questions. */
export const MOCK_SESSION: MockSession = {
  id: 'session-1',
  questions: [
    asked(interviewQuestions.theory, 'Narrowing'),
    asked(interviewQuestions.pitfall, 'Hooks'),
  ],
}

const NARROWING = 'https://www.typescriptlang.org/docs/handbook/2/narrowing.html'

/** A first answer's grade, partly right, with a follow-up and the bank's answer. */
export const PARTLY_RIGHT: MockGrade = {
  questionId: interviewQuestions.theory.id,
  step: 'question',
  score: 1,
  feedback:
    'You are right that `if` narrows on truthiness [1]. You left out how TypeScript treats values such as `0`, `NaN` and `""`, which coerce to `false` [2].',
  citations: [
    {
      number: 1,
      url: `${NARROWING}#truthiness-narrowing`,
      title: 'Narrowing > Truthiness narrowing',
    },
    {
      number: 2,
      url: `${NARROWING}#truthiness-narrowing`,
      title: 'Narrowing > Truthiness narrowing (part 2 of 2)',
    },
  ],
  followUp: 'Which values coerce to `false` in a condition?',
  reference: {
    answer: interviewQuestions.theory.answer,
    citation: interviewQuestions.theory.citation,
  },
  skipped: false,
}

/** The answer to the follow-up, right. */
export const FOLLOW_UP_RIGHT: MockGrade = {
  questionId: interviewQuestions.theory.id,
  step: 'follow-up',
  score: 2,
  feedback: 'Right: `0`, `NaN`, `""`, `0n`, `null` and `undefined` all coerce to `false` [1].',
  citations: [
    {
      number: 1,
      url: `${NARROWING}#truthiness-narrowing`,
      title: 'Narrowing > Truthiness narrowing',
    },
  ],
  skipped: false,
}

/** A skipped answer: scored 0, with no call. */
export const skippedGrade = (request: MockAnswerRequest): MockGrade => ({
  questionId: request.questionId,
  step: request.step,
  score: 0,
  feedback: 'Skipped: nothing to grade.',
  citations: [],
  skipped: true,
})

export const MOCK_SUMMARY: MockSummary = {
  sessionId: 'session-1',
  questions: [
    {
      questionId: interviewQuestions.theory.id,
      source: 'typescript',
      topicTitle: 'Narrowing',
      prompt: interviewQuestions.theory.prompt,
      score: 3,
      max: 4,
    },
    {
      questionId: interviewQuestions.pitfall.id,
      source: 'react',
      topicTitle: 'Hooks',
      prompt: interviewQuestions.pitfall.prompt,
      score: 0,
      max: 2,
    },
  ],
  score: 3,
  max: 6,
  weakTopics: [
    { source: 'react', topicId: 'reference/hooks', title: 'Hooks', score: 0, max: 2 },
    {
      source: 'typescript',
      topicId: 'handbook-v2/Narrowing',
      title: 'Narrowing',
      score: 3,
      max: 4,
    },
  ],
  read: [
    {
      url: interviewQuestions.pitfall.citation.url,
      title: 'useEffect > Specifying reactive dependencies',
    },
    { url: interviewQuestions.theory.citation.url, title: 'Narrowing > Truthiness narrowing' },
  ],
  costUsd: 0.0214,
}

const BASICS = 'https://www.typescriptlang.org/docs/handbook/2/basic-types.html'

/**
 * A check of an answer written in Russian, on the strictNullChecks card, with the feedback in the
 * answer's language, as the grader is asked to write it. Written by hand: no check has been run.
 */
export const CHECKED: AnswerCheck = {
  questionId: CARDS.strictNullChecks.question.id,
  score: 1,
  feedback:
    'Верно: по умолчанию `null` и `undefined` можно присвоить любому другому типу [1]. Не хватает того, что делает флаг: со `strictNullChecks` их приходится обрабатывать явно [1].',
  citations: [
    { number: 1, url: `${BASICS}#strictnullchecks`, title: 'The Basics > strictNullChecks' },
  ],
  costUsd: 0.0094,
}

/** Answers from the data above at once, and records each review, flag, answer and check it was sent. */
export function storyTransport(
  options: {
    summary?: PracticeSummary
    deck?: PracticeCard[]
    reviews?: ReviewRequest[]
    flags?: FlagRequest[]
    answers?: MockAnswerRequest[]
    checks?: AnswerCheckRequest[]
    /** What a check gives, with the signal that gives it up: CHECKED by default. */
    check?: (request: AnswerCheckRequest, signal?: AbortSignal) => Promise<AnswerCheck>
  } = {},
): InterviewTransport {
  const deck = options.deck ?? Object.values(CARDS)
  return {
    mockStart: () => Promise.resolve(MOCK_SESSION),
    mockAnswer: (request) => {
      options.answers?.push(request)
      if (request.answer === '') return Promise.resolve(skippedGrade(request))
      return Promise.resolve(request.step === 'question' ? PARTLY_RIGHT : FOLLOW_UP_RIGHT)
    },
    mockSummary: () => Promise.resolve(MOCK_SUMMARY),
    check: (request, signal) => {
      options.checks?.push(request)
      return (
        options.check?.(request, signal) ??
        Promise.resolve({ ...CHECKED, questionId: request.questionId })
      )
    },
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
