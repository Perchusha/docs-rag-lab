// @ts-check
import js from '@eslint/js'
import comments from '@eslint-community/eslint-plugin-eslint-comments/configs'
import prettier from 'eslint-config-prettier/flat'
import { defineConfig } from 'eslint/config'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/**
 * Shared flat config. Each package passes its own directory, so type-aware
 * rules resolve that package's tsconfig.json.
 *
 * @param {string} tsconfigRootDir
 */
export function createConfig(tsconfigRootDir) {
  return defineConfig(
    { ignores: ['**/dist/**', '**/.next/**', '**/coverage/**', '**/__fixtures__/**'] },
    js.configs.recommended,
    tseslint.configs.strictTypeChecked,
    tseslint.configs.stylisticTypeChecked,
    {
      languageOptions: {
        parserOptions: { projectService: true, tsconfigRootDir },
      },
    },
    comments.recommended,
    {
      // SPEC section 14: no `any` without an explaining comment. A disable
      // directive must say why, after `--`.
      rules: { '@eslint-community/eslint-comments/require-description': 'error' },
    },
    {
      files: ['**/*.js', '**/*.cjs', '**/*.mjs'],
      extends: [tseslint.configs.disableTypeChecked],
      languageOptions: { globals: globals.node },
    },
    prettier,
  )
}
