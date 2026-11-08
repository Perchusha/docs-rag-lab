// The interview-prep app's own state: data/apps/interview-prep.sqlite (SPEC section 4, ADR-0018).
// One row per card the owner has rated, with its FSRS state as JSON and when it is due, and one
// row per rating. Core computes the state; this module only keeps it.
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
