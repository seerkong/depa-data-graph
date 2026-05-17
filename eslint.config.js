import eslint from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/*.d.ts',
      '**/.tmp/**',
      '**/.opencode/**',
      '**/.codex/**',
      '**/.claude/**',
    ],
  },
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['**/*.js', '**/*.cjs', '**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    rules: {
      // Avoid churn: allow `any` in the existing codebase.
      '@typescript-eslint/no-explicit-any': 'off',

      // Allow underscore-prefixed placeholders.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    files: ['**/test/**/*.{ts,tsx}', '**/*.{test,spec}.{ts,tsx}'],
    rules: {
      // Tests sometimes need to poke at private/unsupported APIs.
      '@typescript-eslint/ban-ts-comment': 'off',
    },
  },
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
);
