import type { Preview } from '@storybook/react-vite'

import '../src/tokens.css'
import './preview.css'

const preview: Preview = {
  parameters: {
    // axe runs on every story, and any violation fails the story's test
    // (vitest.config.ts runs each story in a light and a dark browser).
    a11y: { test: 'error' },
  },
}

export default preview
