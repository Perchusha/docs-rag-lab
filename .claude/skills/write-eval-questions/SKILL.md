---
name: write-eval-questions
description: Draft golden-set questions with anchors for a documentation source, from the docs' text alone, and flag the ones a human should review. Use when a source needs a golden set or new candidate questions.
argument-hint: <source id>
---

# Draft golden questions for `$0`

If no source id was given, ask for one and stop.

Read first: SPEC section 10 (the format), ADR-0009 (anchors, the lock and the freeze), ADR-0015 (the flags), and the ADR that fixes this source's test, which says how many questions of each group to write. React's is ADR-0016. If there is no such ADR, stop and say so.

A frozen set is never changed for a ranking. To add to one, follow ADR-0009 section 9.

## What keeps the measurement honest

- **Write from the docs' text only.** Read the pages in `.cache/sources/$0`, which holds the commit the index is at, and do not write there.
- **Look at no retrieval and no answer.** No `drl search`, no `drl ask`, no `drl eval` other than the two commands below, no inspector, and nothing under `eval/reports/$0/`. Anchors found by looking at what the retrievers return favour those retrievers (ADR-0009).
- **Never choose a question by what Claude or a retriever gets wrong.** It would make the result true by construction (ADR-0016).

The two commands read the index and git, and rank nothing:

- `pnpm drl eval walk --source $0` lists every indexed page and heading, newest first by git history. The first run clones the docs' history under the cache.
- `pnpm drl eval check --draft --source $0` checks `eval/questions.draft.jsonl`: which anchors do not resolve, and what each question copies from the docs.

## 1. Fresh questions, by the walk

Skip this if the source's ADR asks for no `fresh` questions.

1. Run the walk, with `--top <n>` if the list runs out before you have enough. A longer list starts the same.
2. Go down the list in order, as the ADR says. Each page or heading gives at most one question, tagged `fresh`. Skip an entry only for one of the ADR's reasons, and write the reason down. Do not go looking for a better entry further down.
3. If the ADR fixes which question of the walk is asked in another language, follow it, whatever that question turns out to be.
4. Keep the walk in `packages/sources/$0/eval/fresh-walk.md`, a table of every entry you went through, down to the last question taken: date, commit, place, what became of it (the question's id, or the skip and its reason). Say at the top how far back the last question goes. It is committed with the draft.

## 2. The draft

Write `packages/sources/$0/eval/questions.draft.jsonl`, one question per line. `packages/sources/typescript/eval/questions.jsonl` shows the shape.

- **`id`:** letters, a hyphen and four digits, as in `react-0001`.
- **`question`:** one question a developer would ask, in your own words, that one passage can settle. Ask about the fact and do not quote it. If there is a natural way to say it without the docs' wording, use it. If the term has no other name, keep it and flag the question.
- **`answer`:** what a correct answer says, from the passage alone. The judge grades against it, so leave out anything you know from elsewhere.
- **`primary`:** the passages the answer was written from, each as `{"at": "<repo path>#<anchor>", "contains": "<literal passage>"}`. The answer needs all of them, unless `"primaryMatch": "any"` says each is enough on its own. Pin `contains` to a short literal from the page, so that the anchor is the part that holds the answer. The repository's check refuses em dashes in this file, so choose a literal without one.
- **`tags`:** from SPEC section 10.
- **A question in another language** is a paraphrase with `cross-lingual`, with the same anchors. Its answer can stay in English.
- **A question the docs do not answer** has no anchors and is tagged `unanswerable`. Its answer says what a correct reply says: that the docs do not cover it or, for a false premise, that the premise is wrong and why. Search the pages by hand before you claim that nothing covers it, and say in `note` where you looked.
- **`note`:** why it is graded as it is, whenever that is not obvious.

## 3. The check

Run `pnpm drl eval check --draft --source $0`. Every anchor has to resolve: fix the anchor from the docs' text, and do not change the question to fit the index. Reword a question that copies wording when a natural rewording exists, and otherwise keep it as a flag.

## 4. The flags

Write `packages/sources/$0/eval/questions.review.md`, for the owner, who reviews only these. A question is flagged when:

1. its answer or its anchor took a judgement call: the docs text leaves room, or the passage spans sections;
2. the docs do not answer it, where only a person can say that nothing covers it, so every `unanswerable` question is flagged;
3. its wording copies a heading or a sentence from the docs, by the check above or by reading it;
4. its answer depends on a version or a default that changed, the stale-page risk of ts-0039 and ts-0017.

For each one give the question, the answer, the passage quoted with its place, which flag it has, and what you need the owner to decide. Say at the top how many of the set are flagged, and that the rest will be frozen unread. The same check reads this file and `fresh-walk.md`, so write an em dash from the docs as a hyphen, and say at the top that you did.

Then stop and wait for the owner.

## 5. Freezing

After the owner's review, and before any row answers:

1. Apply their decisions to the draft, and rename it to `eval/questions.jsonl`.
2. `pnpm drl eval check --source $0` lists the anchors to accept, and `pnpm drl eval check --source $0 --accept` writes the lock.
3. Add version 1 to the changelog in ADR-0009, saying who drafted the set and what the owner reviewed.
4. Commit all of it, with `fresh-walk.md` and `questions.review.md`. Every report after this stamps a commit that has this one as its ancestor.
