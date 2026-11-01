// violation: contracts-client-safe (no Node.js built-ins)
import { readFileSync } from 'node:fs'

export const read = readFileSync
