// violation: ui-no-node-builtins
import { readFileSync } from 'node:fs'

export const read = readFileSync
