# React's golden set: the questions for review

**10 of the 20 questions were flagged, and the owner reviewed those.** Of the other 10, the owner decided the anchors of react-0007, 0010, 0011 and 0012, from a short description of each. The other 6 (react-0004 to 0006, 0009, 0013 and 0014) were frozen unread, by ADR-0015.

This file keeps the draft's questions and what was asked, as the owner saw them. The set as frozen is `questions.jsonl`.

## What the owner decided, on 2026-11-05

After the review below, a text search of the docs found passages that also settle some questions, and the draft had no `acceptable` anchor for them. It was a search for key words, with no retrieval, so it may have missed some. The owner decided each one.

| Question | Decision |
|---|---|
| react-0001, 0002 | The status rule applies as written, with no exception on react-0002. Two cases of known grade try it. |
| react-0003 | Both sections stay primary, with `primaryMatch: any`. |
| react-0007 | Acceptable: `reference/react/use.md#use-browser`. |
| react-0008 | It counts as fresh, and the status rule stays out of it. Acceptable: `reference/react/Suspense.md#coordinating-fonts-images-and-stylesheets`. |
| react-0010 | Acceptable: the sections on reading the value when submitting a form in `input.md`, `select.md` and `textarea.md`. |
| react-0011 | No new anchor. By ADR-0009, an acceptable anchor cannot answer only half: the expected answer gives the array of state pairs as well as the call order, and `lints/rules-of-hooks.md` states only the order. The status rule does not apply, and the note says so. |
| react-0012 | Acceptable: `reference/eslint-plugin-react-hooks/lints/static-components.md#rule-details`. The status rule does not apply, and the note says so. |
| react-0015 | The copy stays. `reference/react/useReducer.md#im-getting-an-error-too-many-re-renders` is a second primary, with `primaryMatch: any`, as for ts-0040. `learn/tutorial-tic-tac-toe.md#lifting-state-up` is acceptable. The expected answer does not change: the question names no hook, so the note makes the `useReducer` case optional to mention. |
| react-0016 | The answer stands. Acceptable: `reference/react/useImperativeHandle.md#parameters`. |
| react-0017, 0018 | The false premises stay: they test whether an answer trusts the docs over memory. |
| react-0019 | The docs are silent, confirmed by a second search. The note now says that a row that gives other libraries' sizes as if they answered has not answered. |
| react-0020 | The docs are silent, confirmed by a second search. As written. |
| The walk | A heading that only lost `<CanaryBadge />` stays skipped, with the reason in ADR-0016. |

## The questions as they were asked

Claude drafted the set at `2177e28d`, from the pages' text alone. No retrieval ran, and no answer was read. "The docs" means the indexed pages, under `src/content/learn` and `src/content/reference`. The blog and the community pages are not indexed.

The repository's check refuses em dashes in this file, so one from the docs would be written as a hyphen. None of these passages has one.

`pnpm drl eval check --draft --source react` passes: every anchor resolves, and no page gives more than 2 fresh questions. It reports a copy on react-0001 and 0002 because it splits the package name `react-devtools-cdt-mcp` into 4 words. That is one identifier, which ADR-0016 does not count.

## The status rule, on 2 questions

Both have the note ADR-0016 asks for, and it reaches the judge as a grading note. **Two cases of known grade have tried this path:** on react-0002's expert answer without its last sentence, the status, the judge gave 1, and its reasoning named the note. On the expert answer itself it gave 2. That answer is the expert's word for word, so these cases do not show how the judge treats a status given in other words.

### react-0001, fresh

- **Question:** What does `react-devtools-cdt-mcp` let a coding agent see in my app?
- **Answer:** It gives AI coding agents the same view of your app that React DevTools gives you: the component tree, props, hooks, owners, source locations and render timing. It is experimental: both its tools and their output may change between releases.
- **Passage:** `reference/dev-tools/react-devtools-cdt-mcp.md`, the intro: "`react-devtools-cdt-mcp` gives AI coding agents the same view of your app that React DevTools gives you: the component tree, props, hooks, owners, source locations, and render timing." The status is in the frontmatter, `version: experimental`, and in the box above it: "`react-devtools-cdt-mcp` is experimental."
- **Flag:** ADR-0016's status rule. The question does not ask for the status, on purpose: asking would tell a row what to say.
- **To decide:** whether the note's wording is what you want on the label sheet: "this API is on the experimental channel, so the status is part of what a fully correct answer gives, and an answer that does not say it is experimental scores at most 1."

### react-0002, fresh

- **Question:** Do I have to add `react-devtools-cdt-mcp` as a server in my MCP client configuration?
- **Answer:** No. It is not an MCP server and does not go in the MCP client config. It is a small browser library you import into the page you are debugging, and it runs inside that page. The only MCP server you configure is Chrome DevTools MCP, which discovers the React tools automatically when it connects to the page. It is experimental.
- **Passage:** `reference/dev-tools/react-devtools-cdt-mcp.md#overview`: "`react-devtools-cdt-mcp` is **not** an MCP server, and it doesn't go in your MCP client config. It runs inside your page. The only MCP server you configure is Chrome DevTools MCP."
- **Flag:** ADR-0016's status rule. This section is in the page's first chunk, which also holds the box, so react-0001 and react-0002 have the same chunk as their target. Every chunk of the page starts with its title, `React DevTools for agents (Experimental)`.
- **To decide:** the same note as react-0001. A "no" with no status scores at most 1 here, although the question has nothing to do with stability. That is what your rule says for a fresh question on this API, and I want you to see it on a question like this one.

## Judgement calls, on 2 questions

### react-0003, fresh

- **Question:** How can I keep React from preloading a particular `<img>` when rendering on the server?
- **Answer:** Set `loading="lazy"` or `fetchPriority="low"` on that image. During server rendering, either one prevents React from automatically preloading it.
- **Passages,** with `primaryMatch: any`, so each is enough on its own:
  - `reference/react-dom/components/img.md#props`: "During server rendering, `fetchPriority="low"` also prevents React from automatically preloading the image." and "Setting `loading="lazy"` prevents React from automatically preloading the image."
  - `reference/react-dom/components/img.md#controlling-image-preloading-during-server-rendering`: "Add `loading="lazy"` or `fetchPriority="low"` to an image that should not receive this hint".
- **Flag 1:** the walk's entry was `#props`, and the section with the heading on this topic is further down the same page. Both settle the question, so I made both primary.
- **To decide:** whether both should be primary. The alternative is `#props` alone, with the other one acceptable, which is stricter on retrieval.

### react-0008, fresh

- **Question:** Does `<Suspense>` hold back its content until fonts and images have loaded?
- **Answer:** Not by default: Suspense does not wait for fonts or images. Only when a `<ViewTransition>` animates the boundary's reveal does React wait up to 500 ms for new fonts and for visible images. Setting `loading="lazy"` or adding an `onLoad` handler opts a specific image out.
- **Passage:** `reference/react/Suspense.md#what-activates-a-suspense-boundary`: "Loading fonts. Suspense doesn't wait for fonts by default, but when a `<ViewTransition>` animates a boundary's reveal, React waits up to 500 ms for new fonts to load so text doesn't flash with a fallback font." and "Loading images. Suspense doesn't wait for images by default, but when a `<ViewTransition>` animates a boundary's reveal, React waits up to 500 ms for visible images to load before starting the animation. Setting `loading="lazy"` or adding an `onLoad` handler opts a specific image out."
- **Flag 1,** for two reasons:
  - I took one fact from a list of 7. The last item of the list is experimental, `<Suspense defer>`. The question does not ask about it, so the status rule does not apply. A question on the whole list would need it, and would be hard to grade.
  - The section is new, but `reference/react/ViewTransition.md` already said that `<ViewTransition>` waits up to 500 ms. What is new is the statement on Suspense's own page.
- **To decide:** whether this counts as fresh, and whether the status rule stays out of it.

## Wording and versions, on 2 questions

### react-0015, exact-token

- **Question:** What causes the error `Too many re-renders. React limits the number of renders to prevent an infinite loop.`?
- **Answer:** Typically you are unconditionally setting state during render, so the component enters a loop: render, set state (which causes a render), render, set state. Very often this comes from a mistake in specifying an event handler: `onClick={handleClick()}` calls the handler during render, while `onClick={handleClick}` or an inline function passes it down.
- **Passage:** `reference/react/useState.md#im-getting-an-error-too-many-re-renders`: "You might get an error that says: `Too many re-renders. React limits the number of renders to prevent an infinite loop.` Typically, this means that you're unconditionally setting state *during render*".
- **Flag 3:** it copies the passage and the heading. An exact-token question is about that text, which has no other name.
- **To decide:** whether to keep the copy. I would.

### react-0016, version

- **Question:** In React 19, do I still need `forwardRef` so that a parent can give a ref to my component?
- **Answer:** No. In React 19 `forwardRef` is no longer necessary: pass `ref` as a prop instead. `forwardRef` will be deprecated in a future release.
- **Passage:** `reference/react/forwardRef.md`, the box at the top: "In React 19, `forwardRef` is no longer necessary. Pass `ref` as a prop instead. `forwardRef` will be deprecated in a future release."
- **Flag 4:** the answer depends on a version, and a later release can make the page stale, the risk of ts-0039 and ts-0017.
- **To decide:** nothing beyond whether the answer is right. It is pinned to the page's words.

## The docs do not answer, on 4 questions

Only a person can say that nothing covers these. I searched every page under `learn/` and `reference/` for what each note names.

### react-0017, false premise

- **Question:** What is the default value of the `timeoutMs` option of `useTransition`?
- **Answer:** The premise is wrong: `useTransition` does not take any parameters, so it has no `timeoutMs` option.
- **Where I looked:** `reference/react/useTransition.md`, under Parameters: "`useTransition` does not take any parameters." `timeoutMs` appears on no page.
- **To decide:** whether a false premise that the docs refute in so many words is what you want here, since a row that reads that page has an easy time.

### react-0018, false premise

- **Question:** Which option makes `useEffect` run during server rendering as well?
- **Answer:** The premise is wrong: no option does that. Effects only run on the client, and they do not run during server rendering.
- **Where I looked:** `reference/react/useEffect.md`, under Caveats: "Effects **only run on the client.** They don't run during server rendering." A search for an option of that kind, such as `runOnServer`, finds nothing.
- **To decide:** whether nothing in the docs offers a way to do this. I found none.

### react-0019, not covered

- **Question:** How large is `react-dom` in kilobytes once minified and gzipped?
- **Answer:** The React docs do not cover this: they do not state the size of `react-dom`.
- **Where I looked:** bundle size, kB, kilobyte, gzip and minified. They find general advice about bundle size, such as in `learn/understanding-your-ui-as-a-tree.md`, and gzipped sizes only for `marked` and `sanitize-html`, in an example in `reference/rsc/server-components.md`.
- **To decide:** whether a row that quotes those two libraries' sizes as if they answered it should count as wrong. By the answer as written, it does.

### react-0020, not covered

- **Question:** How do I set up Jest snapshot tests for my components?
- **Answer:** The React docs do not cover this: neither Jest nor snapshot testing appears in them.
- **Where I looked:** Jest and snapshot tests find nothing. The closest page is `reference/react/act.md`, which covers `act` and names React Testing Library.
- **To decide:** whether a row that points to `act` and says the docs do not cover Jest is correct. By the answer as written, it is. One that describes `act` as the way to do this has not answered.

## The walk, for you to check

`fresh-walk.md` has every entry. It went back to 2026-06-24, through 67 entries, to get 10 questions from 6 pages. Three of its readings shape the set, and they are yours to overrule:

1. **A heading that only lost `<CanaryBadge />` is "reworded and not new".** That skips 10 entries from the commit that prepared the site for React 19.3, 2026-09-09, including `FragmentInstance` and `use(browser())`. The commit suggests they went stable there, so someone could call that fresh. The ADR's reason says that a reworded entry is not new, and the badge's removal adds no fact to the page, so I skipped them. Taking them would change the set the most of the three: the last 6 places would go 2 each to `Fragment.md`, `Suspense.md` and `use.md`, the walk would stop at 2026-09-09, and `server-components.md`, `browser.md` and `form.md` would drop out. The question in Russian would become one on `FragmentInstance`.
2. **A page's own entry counts only for what stands above its first heading.** That skips `<img>`, whose intro says only that it embeds an image. `react-devtools-cdt-mcp` and `browser` have a fact there, and each gave one.
3. **"The same feature" means the same fact, not the same API.** Otherwise each page could give only 1, and the limit of 2 would mean nothing. So `react-0006` and `react-0007` are both on `browser`, and `react-0001` and `react-0002` are both on `react-devtools-cdt-mcp`.

No fresh question landed on a `lints/` page, where a row could not see the status it would be asked for.
