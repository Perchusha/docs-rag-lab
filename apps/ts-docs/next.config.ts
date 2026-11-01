// Next.js config for ts-docs (ADR-0008). The workspace packages need no
// transpilePackages: pnpm links them to real paths outside node_modules, and
// Turbopack compiles them like app code.
import { fileURLToPath } from 'node:url'

import type { NextConfig } from 'next'

const root = fileURLToPath(new URL('../..', import.meta.url))

const config: NextConfig = {
  // sqlite-vec finds its native library with import.meta.resolve, which breaks
  // when bundled. better-sqlite3 is on Next's own list; named here so both
  // native modules are in one place.
  serverExternalPackages: ['better-sqlite3', 'sqlite-vec'],
  // The workspace root, so Turbopack and file tracing see the packages.
  turbopack: { root },
  outputFileTracingRoot: root,
  // next dev would write an AGENTS.md into the app (with an em dash in it).
  agentRules: false,
}

export default config
