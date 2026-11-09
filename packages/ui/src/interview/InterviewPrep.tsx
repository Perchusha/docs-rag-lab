'use client'
// The interview-prep app (ADR-0018): choose technologies, then Quick 10 or a topic, and practise
// card by card. An app renders this from a server component with its config: serializable props
// only, so the transport is built here from the endpoints unless a story passes its own.
import type { PracticeCard, PracticeOverview, Rating, TopicProgress } from '@docs-rag-lab/contracts'
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'

import type { Theme } from '../DocsAssistant.tsx'
import common from '../lib/common.module.css'
import {
  fetchInterviewTransport,
  type InterviewEndpoints,
  type InterviewTransport,
} from '../lib/interview-transport.ts'
import { useFocusRing } from '../lib/useFocusRing.ts'
import styles from './Interview.module.css'
import { PracticeStart } from './PracticeStart.tsx'
import { QuestionCard } from './QuestionCard.tsx'
import { TechPicker } from './TechPicker.tsx'
import { TopicMap } from './TopicMap.tsx'

export interface InterviewPrepProps {
  title: string
  tagline?: string | undefined
  /** The technologies the app offers, in order: each a source with a bank. */
  sources: readonly { id: string; title: string }[]
  theme?: Theme | undefined
  endpoints: InterviewEndpoints
  /** Replaces fetch over the endpoints, for stories and tests. */
  transport?: InterviewTransport | undefined
}

type View =
  | { kind: 'home' }
  | {
      kind: 'practice'
      label: string
      cards: PracticeCard[]
      index: number
      ratings: Rating[]
      /** Cards flagged as wrong in this sitting, which are hidden from now on. */
      flagged: number
    }
  | { kind: 'done'; label: string; ratings: Rating[]; flagged: number }

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const plural = (count: number, one: string): string =>
  `${String(count)} ${count === 1 ? one : `${one}s`}`

export function InterviewPrep(props: InterviewPrepProps) {
  const { title, sources, theme, endpoints } = props
  const transport = useMemo(
    () => props.transport ?? fetchInterviewTransport(endpoints),
    [props.transport, endpoints],
  )
  const [chosen, setChosen] = useState<string[]>(() => sources.map(({ id }) => id))
  const [overview, setOverview] = useState<PracticeOverview | undefined>()
  const [view, setView] = useState<View>({ kind: 'home' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const doneHeading = useRef<HTMLHeadingElement>(null)
  useFocusRing()

  const titles = useMemo(
    () => Object.fromEntries(sources.map(({ id, title: name }) => [id, name])),
    [sources],
  )

  // The overview again whenever the choice changes or practice ends. A late answer to an earlier
  // choice is dropped.
  const [generation, setGeneration] = useState(0)
  useEffect(() => {
    let current = true
    transport.overview(chosen).then(
      (value) => {
        if (!current) return
        setOverview(value)
        setError(undefined)
      },
      (failure: unknown) => {
        if (current) setError(messageOf(failure))
      },
    )
    return () => {
      current = false
    }
  }, [transport, chosen, generation])

  useEffect(() => {
    if (view.kind === 'done') doneHeading.current?.focus()
  }, [view.kind])

  const start = async (label: string, topic?: TopicProgress) => {
    setBusy(true)
    try {
      const deck = await transport.deck(
        chosen,
        topic === undefined ? undefined : { source: topic.source, id: topic.id },
      )
      setError(undefined)
      if (deck.cards.length === 0) {
        setError('Nothing to practise there right now: every card is waiting for its day.')
      } else {
        setView({ kind: 'practice', label, cards: deck.cards, index: 0, ratings: [], flagged: 0 })
      }
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      setBusy(false)
    }
  }

  /** Saves what the owner did with the current card, then goes on to the next one. */
  const act = async (
    save: (card: PracticeCard) => Promise<unknown>,
    after: { rating?: Rating; flagged?: boolean },
    what: string,
  ) => {
    if (view.kind !== 'practice' || busy) return
    const card = view.cards[view.index]
    if (card === undefined) return
    setBusy(true)
    try {
      await save(card)
      setError(undefined)
      const ratings = after.rating === undefined ? view.ratings : [...view.ratings, after.rating]
      const flagged = view.flagged + (after.flagged === true ? 1 : 0)
      setView(
        view.index + 1 < view.cards.length
          ? { ...view, index: view.index + 1, ratings, flagged }
          : { kind: 'done', label: view.label, ratings, flagged },
      )
    } catch (failure) {
      setError(`The ${what} was not saved: ${messageOf(failure)}`)
    } finally {
      setBusy(false)
    }
  }

  const rate = (rating: Rating) =>
    act((card) => transport.review({ questionId: card.question.id, rating }), { rating }, 'rating')

  const flag = (reason: string) =>
    act(
      (card) => transport.flag({ questionId: card.question.id, reason }),
      { flagged: true },
      'flag',
    )

  const home = () => {
    setView({ kind: 'home' })
    setGeneration((value) => value + 1)
  }

  const style =
    theme === undefined
      ? undefined
      : ({
          '--accent-light': theme.accent.light,
          '--accent-dark': theme.accent.dark,
        } as CSSProperties)

  const card = view.kind === 'practice' ? view.cards[view.index] : undefined
  const status =
    view.kind === 'practice'
      ? `${view.label}: card ${String(view.index + 1)} of ${String(view.cards.length)}`
      : view.kind === 'done'
        ? `${view.label} done`
        : overview === undefined
          ? 'Loading'
          : ''

  return (
    <div className={styles.root} data-drl-theme="" style={style}>
      <main className={styles.page}>
        <header className={styles.header}>
          <h1>{title}</h1>
          {props.tagline !== undefined && <p className={styles.tagline}>{props.tagline}</p>}
        </header>
        <p role="status" className={common.srOnly}>
          {status}
        </p>
        {error !== undefined && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        {view.kind === 'home' && (
          <>
            <TechPicker
              sources={sources.map((source) => ({
                ...source,
                questions: overview?.sources.find(({ id }) => id === source.id)?.questions,
              }))}
              chosen={chosen}
              onChange={setChosen}
            />
            <PracticeStart
              summary={overview?.summary}
              sourceTitles={chosen
                .filter(
                  (id) => overview?.sources.find((source) => source.id === id)?.questions !== 0,
                )
                .map((id) => titles[id] ?? id)}
              busy={busy}
              onQuick={() => {
                void start('Quick 10')
              }}
            />
            {overview !== undefined && overview.groups.length > 0 && (
              <TopicMap
                groups={overview.groups}
                sourceTitles={titles}
                onPractice={(topic) => {
                  void start(topic.title, topic)
                }}
              />
            )}
          </>
        )}
        {view.kind === 'practice' && card !== undefined && (
          <>
            <div className={styles.actions}>
              <button type="button" className={common.button} onClick={home}>
                Back to topics
              </button>
              <span className={styles.muted}>{view.label}</span>
            </div>
            <QuestionCard
              key={card.question.id}
              card={card}
              index={view.index + 1}
              total={view.cards.length}
              sourceTitle={titles[card.question.source] ?? card.question.source}
              busy={busy}
              onRate={(rating) => {
                void rate(rating)
              }}
              onFlag={(reason) => {
                void flag(reason)
              }}
            />
          </>
        )}
        {view.kind === 'done' && (
          <section className={styles.section} aria-labelledby="drl-done-heading">
            <h2 id="drl-done-heading" ref={doneHeading} tabIndex={-1}>
              {`${view.label} done`}
            </h2>
            <p>
              {`${plural(view.ratings.length, 'card')}, ${String(
                view.ratings.filter((rating) => rating === 'good' || rating === 'easy').length,
              )} known. Each comes back when it is due.`}
              {view.flagged > 0 &&
                ` ${plural(view.flagged, 'card')} flagged as wrong, hidden from now on.`}
            </p>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.primary}
                disabled={busy}
                onClick={() => {
                  void start('Quick 10')
                }}
              >
                Quick 10 again
              </button>
              <button type="button" className={common.button} onClick={home}>
                Back to topics
              </button>
            </div>
          </section>
        )}
      </main>
    </div>
  )
}
