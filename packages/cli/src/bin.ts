#!/usr/bin/env node
// The drl executable. Node runs this TypeScript directly (type stripping), and
// the workspace packages it imports through node_modules links (ADR-0001).
import { run } from './run.ts'

process.exitCode = await run(process.argv.slice(2))
