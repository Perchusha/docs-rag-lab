// The interview-prep app's own state: data/apps/interview-prep.sqlite (SPEC section 4, ADR-0018).
// One row per card the owner has rated, with its FSRS state as JSON and when it is due, one row
// per rating, one per card the owner flagged as wrong, with the reason, and the mock interviews:
// each session's questions, and each graded answer. Core computes all of it; this module only
// keeps it.
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

import { migrate, openDatabase, type SqliteDatabase } from './open.ts'

const MIGRATIONS = [
  `
  create table cards (
    question_id text primary key,
    state text not null,
    due text not null,
    last_rating integer not null,
    reviews integer not null
  ) without rowid;
  create index cards_due on cards (due);
  create table reviews (
    id integer primary key,
    question_id text not null,
    rating integer not null,
    reviewed_at text not null
  );
  `,
  `
  create table flags (
    question_id text primary key,
    reason text not null,
    flagged_at text not null
  ) without rowid;
  `,
  `
  create table mock_sessions (
    id text primary key,
    question_ids text not null,
    started_at text not null
  ) without rowid;
  create table mock_turns (
    session_id text not null references mock_sessions (id),
    question_id text not null,
    step text not null,
    prompt text not null,
    answer text not null,
    score integer not null,
    feedback text not null,
    citations text not null,
    follow_up text,
    cost_usd real not null,
    answered_at text not null,
    primary key (session_id, question_id, step)
  );
  `,
]

/** A card the owner has rated: its FSRS state, as core serialises it, and when it is due. */
export interface StoredCard {
  questionId: string
  state: string
  /** An ISO date and time, so that text order is time order. */
  due: string
  /** 1 to 4, again to easy. */
  lastRating: number
  reviews: number
}

export interface CardReview {
  card: StoredCard
  rating: number
  reviewedAt: string
}

/** A card the owner found wrong: hidden for them, with the reason, until the bank decides. */
export interface CardFlag {
  questionId: string
  reason: string
  /** An ISO date and time. */
  flaggedAt: string
}

/** A mock interview: the bank questions it asks, in order. */
export interface StoredMockSession {
  id: string
  questionIds: string[]
  /** An ISO date and time. */
  startedAt: string
}

/** One graded answer of a mock interview, as core serialises it. */
export interface StoredMockTurn {
  sessionId: string
  questionId: string
  /** question or follow-up. */
  step: string
  /** What was asked: the question, or the follow-up. */
  prompt: string
  answer: string
  score: number
  feedback: string
  /** The cited passages, as JSON. */
  citations: string
  /** The follow-up the grade asked, after a first answer. */
  followUp: string | null
  costUsd: number
  /** An ISO date and time. */
  answeredAt: string
}

interface MockTurnRow {
  session_id: string
  question_id: string
  step: string
  prompt: string
  answer: string
  score: number
  feedback: string
  citations: string
  follow_up: string | null
  cost_usd: number
  answered_at: string
}

interface CardRow {
  question_id: string
  state: string
  due: string
  last_rating: number
  reviews: number
}

const toCard = (row: CardRow): StoredCard => ({
  questionId: row.question_id,
  state: row.state,
  due: row.due,
  lastRating: row.last_rating,
  reviews: row.reviews,
})

export class InterviewState {
  readonly #db: SqliteDatabase

  constructor(db: SqliteDatabase) {
    migrate(db, MIGRATIONS)
    this.#db = db
  }

  cards(): StoredCard[] {
    return (this.#db.prepare('select * from cards order by question_id').all() as CardRow[]).map(
      toCard,
    )
  }

  card(questionId: string): StoredCard | undefined {
    const row = this.#db.prepare('select * from cards where question_id = ?').get(questionId) as
      CardRow | undefined
    return row === undefined ? undefined : toCard(row)
  }

  /** A rating and the card's new state, together or not at all. */
  saveReview(review: CardReview): void {
    const { card } = review
    this.#db.transaction(() => {
      this.#db
        .prepare('insert into reviews (question_id, rating, reviewed_at) values (?, ?, ?)')
        .run(card.questionId, review.rating, review.reviewedAt)
      this.#db
        .prepare(
          `insert into cards (question_id, state, due, last_rating, reviews)
           values (@questionId, @state, @due, @lastRating, @reviews)
           on conflict (question_id) do update set
             state = excluded.state, due = excluded.due,
             last_rating = excluded.last_rating, reviews = excluded.reviews`,
        )
        .run(card)
    })()
  }

  /** A card flagged as wrong. Flagging it again keeps the new reason. */
  saveFlag(flag: CardFlag): void {
    this.#db
      .prepare(
        `insert into flags (question_id, reason, flagged_at) values (@questionId, @reason, @flaggedAt)
         on conflict (question_id) do update set
           reason = excluded.reason, flagged_at = excluded.flagged_at`,
      )
      .run(flag)
  }

  /** A flag taken back: the card is shown again. False when there was none. */
  deleteFlag(questionId: string): boolean {
    return this.#db.prepare('delete from flags where question_id = ?').run(questionId).changes > 0
  }

  /** Every card flagged as wrong, oldest first. */
  flags(): CardFlag[] {
    const rows = this.#db.prepare('select * from flags order by flagged_at, question_id').all() as {
      question_id: string
      reason: string
      flagged_at: string
    }[]
    return rows.map((row) => ({
      questionId: row.question_id,
      reason: row.reason,
      flaggedAt: row.flagged_at,
    }))
  }

  saveMockSession(session: StoredMockSession): void {
    this.#db
      .prepare('insert into mock_sessions (id, question_ids, started_at) values (?, ?, ?)')
      .run(session.id, JSON.stringify(session.questionIds), session.startedAt)
  }

  mockSession(id: string): StoredMockSession | undefined {
    const row = this.#db.prepare('select * from mock_sessions where id = ?').get(id) as
      { id: string; question_ids: string; started_at: string } | undefined
    if (row === undefined) return undefined
    return {
      id: row.id,
      questionIds: JSON.parse(row.question_ids) as string[],
      startedAt: row.started_at,
    }
  }

  /** One graded answer. A step is answered once: a second answer to it throws. */
  saveMockTurn(turn: StoredMockTurn): void {
    this.#db
      .prepare(
        `insert into mock_turns (session_id, question_id, step, prompt, answer, score, feedback,
           citations, follow_up, cost_usd, answered_at)
         values (@sessionId, @questionId, @step, @prompt, @answer, @score, @feedback, @citations,
           @followUp, @costUsd, @answeredAt)`,
      )
      .run(turn)
  }

  /** A session's graded answers, in the order they were given. */
  mockTurns(sessionId: string): StoredMockTurn[] {
    const rows = this.#db
      .prepare('select * from mock_turns where session_id = ? order by rowid')
      .all(sessionId) as MockTurnRow[]
    return rows.map((row) => ({
      sessionId: row.session_id,
      questionId: row.question_id,
      step: row.step,
      prompt: row.prompt,
      answer: row.answer,
      score: row.score,
      feedback: row.feedback,
      citations: row.citations,
      followUp: row.follow_up,
      costUsd: row.cost_usd,
      answeredAt: row.answered_at,
    }))
  }

  /** Every rating ever given. */
  reviewCount(): number {
    const row = this.#db.prepare('select count(*) as n from reviews').get() as { n: number }
    return row.n
  }

  close(): void {
    this.#db.close()
  }
}

/** Opens data/apps/interview-prep.sqlite (or ':memory:'), creating its folder and tables. */
export function openInterviewState(path: string): InterviewState {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  return new InterviewState(openDatabase(path))
}
