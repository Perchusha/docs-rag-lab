// Three projects (ADR-0008):
// - unit: pure logic (fusion rows, the answer's markdown, the stream reader) in Node;
// - stories: every story is a test in headless Chromium. It must render, its
//   play function must pass, and axe must find no violation (a11y.test is
//   'error' in .storybook/preview.ts). It runs twice, once per colour scheme,
//   so the colour-contrast rule checks the light and the dark tokens;
// - forced-colors: the stories tagged for it, with Playwright's forcedColors on.
//   The palette follows the colour scheme, so it runs under both, and a hard-coded
//   fill cannot match the system colours in both.
// None touches the network: the story tests serve the stories from a local
// Vite server, and the stories replay recorded fixtures.
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

const schemes = ['light', 'dark'] as const

// Pre-bundled up front: found mid-run, Vite reloads the page and the tests that
// were running fail (it happens on every run with an empty cache, as in CI).
const optimizeDeps = { include: ['lucide-react', 'react-markdown', 'remark-gfm'] }

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
        plugins: [storybookTest({ configDir: '.storybook', tags: { exclude: ['forced-colors'] } })],
        optimizeDeps,
        test: {
          name: 'stories',
          // Vitest's default, 63315, is in the range Windows hands to Hyper-V,
          // which changes at each boot. There it fails with EACCES, and Vitest
          // only tries another port when one is taken.
          api: { port: 5199 },
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
      {
        plugins: [storybookTest({ configDir: '.storybook', tags: { include: ['forced-colors'] } })],
        // Its own cache, so that two servers pre-bundling at once cannot reload each other.
        cacheDir: 'node_modules/.vite-forced-colors',
        optimizeDeps,
        test: {
          name: 'forced-colors',
          api: { port: 5198 },
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: schemes.map((colorScheme) => ({
              browser: 'chromium',
              name: `forced-${colorScheme}`,
              provider: playwright({ contextOptions: { colorScheme, forcedColors: 'active' } }),
            })),
          },
        },
      },
    ],
    passWithNoTests: true,
  },
})
