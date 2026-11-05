# The walk that picked the fresh questions

The walk of ADR-0016, from `pnpm drl eval walk --source react` at `2177e28d`, the index's commit. Every entry down to the last question taken is here, in the walk's order.

**How far back it goes:** the tenth question comes from a commit of 2026-06-24, about 19 weeks before the pin. It went through 67 entries: 10 questions and 57 skips, from 6 pages.

**Fresh means newest in these docs.** It does not mean past the answering model's training cutoff.

Paths are under `src/content/`. A skip has one of the ADR's four reasons: moved or reworded and not new; no fact one passage can check; the same feature as a question already taken; or the page has already given 2.

**Where the walk's dates mislead.** The walk dates a heading by the commit that first wrote its exact text, so a reworded heading comes up as new. The diff of each commit shows it, and these are the 18 skips for being reworded or moved:

- 6 headings of `rsc/server-functions.md`, rewritten at the pin itself.
- 10 headings that lost `<CanaryBadge />` when the site was prepared for React 19.3. The APIs they describe are older.
- `use.md#conditional-use` and `form.md#handle-form-submission-with-an-action-prop`, as the table says.

A skipped heading does not come back at its older date: the walk's order is its only order. `questions.review.md` has what these readings decide, for the owner to overrule.

| Date | Commit | Place | What became of it |
|---|---|---|---|
| 2026-11-04 | `2177e28d` | `reference/rsc/server-functions.md#creating-a-server-function-from-a-server-component` | Skipped: reworded, not new. The commit rewrites the heading and keeps its anchor. |
| 2026-11-04 | `2177e28d` | `reference/rsc/server-functions.md#importing-server-functions-from-client-components` | Skipped: reworded, not new. The commit rewrites the heading and keeps its anchor. |
| 2026-11-04 | `2177e28d` | `reference/rsc/server-functions.md#server-functions-with-actions` | Skipped: reworded, not new. The commit rewrites the heading and keeps its anchor. |
| 2026-11-04 | `2177e28d` | `reference/rsc/server-functions.md#using-server-functions-with-form-actions` | Skipped: reworded, not new. The commit rewrites the heading and keeps its anchor. |
| 2026-11-04 | `2177e28d` | `reference/rsc/server-functions.md#server-functions-with-use-action-state` | Skipped: reworded, not new. The commit rewrites the heading and keeps its anchor. |
| 2026-11-04 | `2177e28d` | `reference/rsc/server-functions.md#progressive-enhancement-with-useactionstate` | Skipped: reworded, not new. The commit rewrites the heading and keeps its anchor. |
| 2026-10-20 | `ae5e4807` | `reference/dev-tools/react-devtools-cdt-mcp.md` | **react-0001** |
| 2026-10-20 | `ae5e4807` | `reference/dev-tools/react-devtools-cdt-mcp.md#overview` | **react-0002** |
| 2026-10-20 | `ae5e4807` | `reference/dev-tools/react-devtools-cdt-mcp.md#setup` | Skipped: its page has already given 2. |
| 2026-10-20 | `ae5e4807` | `reference/dev-tools/react-devtools-cdt-mcp.md#install-the-package` | Skipped: its page has already given 2. |
| 2026-10-20 | `ae5e4807` | `reference/dev-tools/react-devtools-cdt-mcp.md#import-it-before-react` | Skipped: its page has already given 2. |
| 2026-10-20 | `ae5e4807` | `reference/dev-tools/react-devtools-cdt-mcp.md#set-up-chrome-devtools-mcp` | Skipped: its page has already given 2. |
| 2026-10-20 | `ae5e4807` | `reference/dev-tools/react-devtools-cdt-mcp.md#try-it` | Skipped: its page has already given 2. |
| 2026-10-20 | `ae5e4807` | `reference/dev-tools/react-devtools-cdt-mcp.md#reference` | Skipped: its page has already given 2. |
| 2026-10-20 | `ae5e4807` | `reference/dev-tools/react-devtools-cdt-mcp.md#tools` | Skipped: its page has already given 2. |
| 2026-10-20 | `ae5e4807` | `reference/dev-tools/react-devtools-cdt-mcp.md#register` | Skipped: its page has already given 2. |
| 2026-10-20 | `ae5e4807` | `reference/dev-tools/react-devtools-cdt-mcp.md#register-parameters` | Skipped: its page has already given 2. |
| 2026-10-20 | `ae5e4807` | `reference/dev-tools/react-devtools-cdt-mcp.md#register-returns` | Skipped: its page has already given 2. |
| 2026-10-20 | `ae5e4807` | `reference/dev-tools/react-devtools-cdt-mcp.md#register-caveats` | Skipped: its page has already given 2. |
| 2026-10-20 | `ae5e4807` | `reference/dev-tools/react-devtools-cdt-mcp.md#troubleshooting` | Skipped: its page has already given 2. |
| 2026-10-20 | `ae5e4807` | `reference/dev-tools/react-devtools-cdt-mcp.md#my-agent-doesnt-see-any-react-tools` | Skipped: its page has already given 2. |
| 2026-10-20 | `ae5e4807` | `reference/dev-tools/react-devtools-cdt-mcp.md#the-component-tree-is-empty` | Skipped: its page has already given 2. |
| 2026-10-20 | `ae5e4807` | `reference/dev-tools/react-devtools-cdt-mcp.md#im-getting-an-error-about-a-browser-like-environment` | Skipped: its page has already given 2. |
| 2026-10-20 | `ae5e4807` | `reference/dev-tools/react-devtools-cdt-mcp.md#source-locations-and-owner-stacks-are-empty` | Skipped: its page has already given 2. |
| 2026-10-20 | `ae5e4807` | `reference/dev-tools/react-devtools-cdt-mcp.md#a-uid-stopped-working` | Skipped: its page has already given 2. |
| 2026-09-23 | `44b0b5f1` | `reference/react-dom/components/img.md` | Skipped: no fact to check. Above its first heading, the page says only that `<img>` embeds an image. |
| 2026-09-23 | `44b0b5f1` | `reference/react-dom/components/img.md#reference` | Skipped: no fact to check. A heading with no text of its own. |
| 2026-09-23 | `44b0b5f1` | `reference/react-dom/components/img.md#img` | Skipped: no fact to check. It says only to render `<img>` to display an image. |
| 2026-09-23 | `44b0b5f1` | `reference/react-dom/components/img.md#props` | **react-0003** |
| 2026-09-23 | `44b0b5f1` | `reference/react-dom/components/img.md#caveats` | **react-0004** |
| 2026-09-23 | `44b0b5f1` | `reference/react-dom/components/img.md#usage` | Skipped: its page has already given 2. |
| 2026-09-23 | `44b0b5f1` | `reference/react-dom/components/img.md#displaying-an-image` | Skipped: its page has already given 2. |
| 2026-09-23 | `44b0b5f1` | `reference/react-dom/components/img.md#controlling-image-preloading-during-server-rendering` | Skipped: its page has already given 2. |
| 2026-09-23 | `44b0b5f1` | `reference/react-dom/components/img.md#waiting-for-an-image-during-a-view-transition` | Skipped: its page has already given 2. |
| 2026-09-09 | `521d4c2d` | `reference/react/Fragment.md#fragmentinstance` | Skipped: reworded, not new. The commit, which prepares the site for React 19.3, only removes `<CanaryBadge />` from the heading. |
| 2026-09-09 | `521d4c2d` | `reference/react/Fragment.md#adding-event-listeners-without-wrapper` | Skipped: reworded, not new. The commit, which prepares the site for React 19.3, only removes `<CanaryBadge />` from the heading. |
| 2026-09-09 | `521d4c2d` | `reference/react/Fragment.md#managing-focus-across-elements` | Skipped: reworded, not new. The commit, which prepares the site for React 19.3, only removes `<CanaryBadge />` from the heading. |
| 2026-09-09 | `521d4c2d` | `reference/react/Fragment.md#scrolling-group-into-view` | Skipped: reworded, not new. The commit, which prepares the site for React 19.3, only removes `<CanaryBadge />` from the heading. |
| 2026-09-09 | `521d4c2d` | `reference/react/Fragment.md#observing-visibility-without-wrapper` | Skipped: reworded, not new. The commit, which prepares the site for React 19.3, only removes `<CanaryBadge />` from the heading. |
| 2026-09-09 | `521d4c2d` | `reference/react/Fragment.md#caching-global-intersection-observer` | Skipped: reworded, not new. The commit, which prepares the site for React 19.3, only removes `<CanaryBadge />` from the heading. |
| 2026-09-09 | `521d4c2d` | `reference/react/Suspense.md#providing-a-fallback-for-browser-only-content` | Skipped: reworded, not new. The commit, which prepares the site for React 19.3, only removes `<CanaryBadge />` from the heading. |
| 2026-09-09 | `521d4c2d` | `reference/react/Suspense.md#coordinating-fonts-images-and-stylesheets` | Skipped: reworded, not new. The commit, which prepares the site for React 19.3, only removes `<CanaryBadge />` from the heading. |
| 2026-09-09 | `521d4c2d` | `reference/react/use.md#use-browser` | Skipped: reworded, not new. The commit, which prepares the site for React 19.3, only removes `<CanaryBadge />` from the heading. |
| 2026-09-09 | `521d4c2d` | `reference/react/use.md#rendering-a-component-only-in-the-browser` | Skipped: reworded, not new. The commit, which prepares the site for React 19.3, only removes `<CanaryBadge />` from the heading. |
| 2026-09-09 | `521d4c2d` | `reference/rsc/server-components.md#rendering-a-context-provider-in-a-server-component` | **react-0005**, the fifth of the walk, so in Russian |
| 2026-08-31 | `24618e2a` | `reference/react-dom/browser.md#conditionally-rendering-on-the-server` | **react-0006** |
| 2026-08-19 | `5b3692af` | `reference/react/use.md#usage-browser` | Skipped: no fact to check. A heading with no text of its own. |
| 2026-08-19 | `96ad418a` | `reference/react-dom/browser.md` | **react-0007** |
| 2026-08-19 | `96ad418a` | `reference/react-dom/browser.md#reference` | Skipped: its page has already given 2. |
| 2026-08-19 | `96ad418a` | `reference/react-dom/browser.md#browser` | Skipped: its page has already given 2. |
| 2026-08-19 | `96ad418a` | `reference/react-dom/browser.md#parameters` | Skipped: its page has already given 2. |
| 2026-08-19 | `96ad418a` | `reference/react-dom/browser.md#returns` | Skipped: its page has already given 2. |
| 2026-08-19 | `96ad418a` | `reference/react-dom/browser.md#caveats` | Skipped: its page has already given 2. |
| 2026-08-19 | `96ad418a` | `reference/react-dom/browser.md#usage` | Skipped: its page has already given 2. |
| 2026-08-19 | `96ad418a` | `reference/react-dom/browser.md#rendering-content-only-in-the-browser` | Skipped: its page has already given 2. |
| 2026-08-19 | `96ad418a` | `reference/react-dom/browser.md#reporting-browser-only-rendering-on-the-server` | Skipped: its page has already given 2. |
| 2026-08-19 | `96ad418a` | `reference/react-dom/browser.md#aborting-pending-server-rendering-for-the-browser` | Skipped: its page has already given 2. |
| 2026-08-19 | `96ad418a` | `reference/react-dom/index.md#server-rendering-apis` | Skipped: the same feature as react-0007. It repeats the sentence that says what `browser` does. |
| 2026-07-31 | `c7d6b700` | `reference/react/use.md#conditional-use` | Skipped: reworded, not new. The commit only turns a line of an older box into a heading, to give it an anchor. |
| 2026-07-09 | `efaa3e51` | `reference/react/Suspense.md#what-activates-a-suspense-boundary` | **react-0008** |
| 2026-07-09 | `efaa3e51` | `reference/react/Suspense.md#suspense-enabled-frameworks` | **react-0009** |
| 2026-07-09 | `efaa3e51` | `reference/react/Suspense.md#waiting-for-a-stylesheet-to-load` | Skipped: its page has already given 2. |
| 2026-07-09 | `efaa3e51` | `reference/react/Suspense.md#animating-from-suspense-content` | Skipped: its page has already given 2. |
| 2026-07-09 | `efaa3e51` | `reference/react/Suspense.md#waiting-for-a-font-to-load` | Skipped: its page has already given 2. |
| 2026-07-09 | `efaa3e51` | `reference/react/Suspense.md#waiting-for-an-image-to-load` | Skipped: its page has already given 2. |
| 2026-06-24 | `1f48fb46` | `reference/react-dom/components/form.md#handle-form-submission-with-an-action-prop` | Skipped: moved, not new. The commit renames a heading from earlier that day, and its text was there before under `Handle form submission on the client`. |
| 2026-06-24 | `b6e9b3c4` | `reference/react-dom/components/form.md#handle-form-submission-with-an-event-handler` | **react-0010**, the last question taken |
