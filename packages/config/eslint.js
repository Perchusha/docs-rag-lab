// @ts-check
import js from '@eslint/js'
import comments from '@eslint-community/eslint-plugin-eslint-comments/configs'
import prettier from 'eslint-config-prettier/flat'
import reactHooks from 'eslint-plugin-react-hooks'
import { defineConfig } from 'eslint/config'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/**
 * Shared flat config. Each package passes its own directory, so type-aware
 * rules resolve that package's tsconfig.json.
 *
 * @param {string} tsconfigRootDir
 * @param {{ react?: boolean }} [options] react: the rules of hooks and the
 *   React Compiler rules, for ui and the apps.
 */
export function createConfig(tsconfigRootDir, options = {}) {
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
      // With verbatimModuleSyntax, `import { type A } from 'x'` still loads
      // 'x' at runtime as `import {} from 'x'`. Write `import type` instead,
      // so a types-only boundary (core -> settings, ADR-0007) stays one.
      rules: { '@typescript-eslint/no-import-type-side-effects': 'error' },
    },
    options.react === true ? reactHooks.configs.flat.recommended : {},
    {
      files: ['**/*.js', '**/*.cjs', '**/*.mjs'],
      extends: [tseslint.configs.disableTypeChecked],
      languageOptions: { globals: globals.node },
    },
    prettier,
  )
}
