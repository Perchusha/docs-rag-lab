import { createConfig } from '@docs-rag-lab/config/eslint'
import next from '@next/eslint-plugin-next'
import { defineConfig } from 'eslint/config'

export default defineConfig(
  { ignores: ['next-env.d.ts'] },
  createConfig(import.meta.dirname, { react: true }),
  next.configs['core-web-vitals'],
)
