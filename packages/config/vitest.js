// @ts-check
import { defineConfig } from 'vitest/config'

// Shared Vitest settings. Unit tests never touch the network: tests that do
// are named *.network.test.ts and are excluded here (opt-in from M1).
export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/*.network.test.{ts,tsx}'],
    environment: 'node',
    passWithNoTests: true,
  },
})
