import type { Preview } from '@storybook/react-vite'
import { configure } from 'storybook/test'

import '../src/tokens.css'
import './preview.css'

// findBy* and waitFor give up after 1s by default. On a CI runner shared
// with the other turbo tasks, a replayed answer took longer than that to
// finish; a wait that succeeds returns as soon as it can, so a longer limit
// only costs time when a story is really broken.
configure({ asyncUtilTimeout: 10_000 })

const preview: Preview = {
  parameters: {
    // axe runs on every story, and any violation fails the story's test
    // (vitest.config.ts runs each story in a light and a dark browser).
    a11y: { test: 'error' },
  },
}

export default preview
