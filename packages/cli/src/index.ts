// Public entry of @docs-rag-lab/cli: the drl command runner. The executable is
// src/bin.ts (`pnpm drl <command>` from the repository root).
export { run, USAGE, type RunOptions } from './run.ts'
export { default as config } from './drl.config.ts'
