// Two projects (ADR-0008):
// - unit: pure logic (fusion rows, the answer's markdown, the stream reader) in Node;
// - stories: every story is a test in headless Chromium. It must render, its
//   play function must pass, and axe must find no violation (a11y.test is
//   'error' in .storybook/preview.ts). It runs twice, once per colour scheme,
//   so the colour-contrast rule checks the light and the dark tokens.
// Neither touches the network: the story tests serve the stories from a local
// Vite server, and the stories replay recorded fixtures.
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

const schemes = ['light', 'dark'] as const

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.test.{ts,tsx}'],
          exclude: ['**/node_modules/**', '**/*.network.test.{ts,tsx}'],
          environment: 'node',
        },
      },
      {
        plugins: [storybookTest({ configDir: '.storybook' })],
        // Pre-bundled up front: found mid-run, Vite reloads the page and the
        // tests that were running fail (it happens on every run with an empty
        // cache, as in CI).
        optimizeDeps: { include: ['react-markdown'] },
        test: {
          name: 'stories',
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: schemes.map((colorScheme) => ({
              browser: 'chromium',
              name: colorScheme,
              provider: playwright({ contextOptions: { colorScheme } }),
            })),
          },
        },
      },
    ],
    passWithNoTests: true,
  },
})
