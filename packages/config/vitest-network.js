// @ts-check
import { defineConfig } from 'vitest/config'

// Opt-in network tests (*.network.test.ts): they call real APIs, spend real
// tokens and need keys. The default preset excludes them; this one runs only
// them, from a package's test:network script.
export default defineConfig({
  test: {
    include: ['src/**/*.network.test.{ts,tsx}', 'test/**/*.network.test.{ts,tsx}'],
    exclude: ['**/node_modules/**'],
    environment: 'node',
    testTimeout: 60_000,
  },
})
